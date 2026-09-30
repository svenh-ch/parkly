import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { BecomeHostInput, Me, UpdateMeInput, UserRole } from '@parking/shared';
import type { AuthIdentity, IdentityProvider } from '../adapters/identity';
import type { Database } from '../db/client';
import { auditLogs, bookings, hostProfiles, pushTokens, userRoles, users } from '../db/schema';
import { AppError } from '../lib/errors';

export interface CurrentUser {
  id: string;
  authUserId: string;
  email: string;
  roles: UserRole[];
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
}

type UserRow = typeof users.$inferSelect;

export class UserService {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityProvider,
    private readonly avatarUrl: (path: string) => string,
  ) {}

  /**
   * Lädt den App-Nutzer zur Auth-Identität oder legt ihn beim ersten Request an.
   * Jeder neue Nutzer erhält die Rolle RENTER. Idempotent und race-sicher (ON CONFLICT).
   */
  async resolveCurrentUser(identity: AuthIdentity): Promise<CurrentUser> {
    const existing = await this.loadByAuthId(identity.authUserId);
    if (existing) {
      if (existing.email !== identity.email && existing.status === 'ACTIVE') {
        await this.db.update(users).set({ email: identity.email }).where(eq(users.id, existing.id));
        existing.email = identity.email;
      }
      return existing;
    }

    await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ authUserId: identity.authUserId, email: identity.email })
        .onConflictDoNothing({ target: users.authUserId })
        .returning({ id: users.id });
      if (created) {
        await tx.insert(userRoles).values({ userId: created.id, role: 'RENTER' }).onConflictDoNothing();
      }
    });

    const user = await this.loadByAuthId(identity.authUserId);
    if (!user) throw new Error('Nutzer konnte nicht angelegt werden');
    return user;
  }

  private async loadByAuthId(authUserId: string): Promise<CurrentUser | null> {
    const rows = await this.db
      .select({
        id: users.id,
        authUserId: users.authUserId,
        email: users.email,
        status: users.status,
        roles: sql<UserRole[]>`coalesce(array_agg(${userRoles.role}) filter (where ${userRoles.role} is not null), '{}')`,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .where(eq(users.authUserId, authUserId))
      .groupBy(users.id);
    return rows[0] ?? null;
  }

  async getMe(userId: string): Promise<Me> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!row) throw AppError.notFound('Nutzer nicht gefunden');
    const [roles, [host]] = await Promise.all([
      this.db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId)),
      this.db.select().from(hostProfiles).where(eq(hostProfiles.userId, userId)),
    ]);
    return this.toMe(row, roles.map((r) => r.role), host ?? null);
  }

  async updateMe(userId: string, input: UpdateMeInput): Promise<Me> {
    if (Object.keys(input).length > 0) {
      await this.db.update(users).set(input).where(eq(users.id, userId));
    }
    return this.getMe(userId);
  }

  async acceptTerms(userId: string): Promise<Me> {
    await this.db
      .update(users)
      .set({ termsAcceptedAt: sql`coalesce(${users.termsAcceptedAt}, now())` })
      .where(eq(users.id, userId));
    return this.getMe(userId);
  }

  /** Macht aus einem Mieter zusätzlich einen Vermieter. Stripe-Onboarding folgt separat. */
  async becomeHost(user: CurrentUser, input: BecomeHostInput): Promise<Me> {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(hostProfiles)
        .values({ userId: user.id, displayName: input.displayName, termsAcceptedAt: new Date() })
        .onConflictDoUpdate({ target: hostProfiles.userId, set: { displayName: input.displayName } });
      await tx.insert(userRoles).values({ userId: user.id, role: 'HOST' }).onConflictDoNothing();
      if (!user.roles.includes('HOST')) {
        await tx.insert(auditLogs).values({
          actorId: user.id,
          action: 'ROLE_GRANTED',
          entityType: 'user',
          entityId: user.id,
          metadata: { role: 'HOST' },
        });
      }
    });
    return this.getMe(user.id);
  }

  async registerPushToken(userId: string, token: string, platform: 'IOS' | 'ANDROID' | 'WEB'): Promise<void> {
    await this.db
      .insert(pushTokens)
      .values({ userId, token, platform })
      .onConflictDoUpdate({ target: pushTokens.token, set: { userId, platform } });
  }

  /**
   * Konto löschen (Recht auf Löschung, revDSG). Personendaten werden entfernt; Buchungs- und
   * Zahlungsdatensätze bleiben pseudonymisiert erhalten (Aufbewahrungspflicht, Art. 958f OR).
   */
  async deleteAccount(user: CurrentUser): Promise<void> {
    const [open] = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          inArray(bookings.status, ['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED']),
          gt(bookings.endAt, new Date()),
          sql`(${bookings.renterId} = ${user.id} or ${bookings.hostId} = ${user.id})`,
        ),
      )
      .limit(1);
    if (open) {
      throw AppError.conflict('Konto kann nicht gelöscht werden, solange offene Buchungen bestehen');
    }

    await this.identity.deleteIdentity(user.authUserId);

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          email: `deleted+${user.id}@invalid.local`,
          firstName: null,
          lastName: null,
          phone: null,
          avatarPath: null,
          status: 'DELETED',
          deletedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      await tx.delete(pushTokens).where(eq(pushTokens.userId, user.id));
      await tx.insert(auditLogs).values({
        actorId: user.id,
        action: 'ACCOUNT_DELETED',
        entityType: 'user',
        entityId: user.id,
      });
    });
  }

  private toMe(row: UserRow, roles: UserRole[], host: typeof hostProfiles.$inferSelect | null): Me {
    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      avatarUrl: row.avatarPath ? this.avatarUrl(row.avatarPath) : null,
      locale: row.locale,
      roles: [...roles].sort(),
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      termsAcceptedAt: row.termsAcceptedAt?.toISOString() ?? null,
      hostProfile: host
        ? {
            displayName: host.displayName,
            onboardingStatus: host.onboardingStatus,
            payoutsEnabled: host.payoutsEnabled,
            since: host.createdAt.toISOString(),
          }
        : null,
    };
  }
}
