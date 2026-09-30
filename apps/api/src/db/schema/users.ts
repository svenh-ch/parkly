import { boolean, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamps } from './_shared';
import { hostOnboardingStatusEnum, platformEnum, userRoleEnum, userStatusEnum } from './enums';

/**
 * Anwendungsnutzer. Die Authentifizierung (Passwort-Hash, Sessions) liegt bei Supabase Auth;
 * hier wird nur die auth_user_id referenziert. Keine Passwörter in dieser Datenbank.
 */
export const users = pgTable(
  'users',
  {
    id: id(),
    authUserId: uuid('auth_user_id').notNull().unique(),
    email: text('email').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    phone: text('phone'),
    avatarPath: text('avatar_path'),
    locale: text('locale').notNull().default('de-CH'),
    status: userStatusEnum('status').notNull().default('ACTIVE'),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    /** Stripe-Kunde (gespeicherte Karten), wird beim ersten Bezahlen angelegt. */
    stripeCustomerId: text('stripe_customer_id').unique(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('users_email_idx').on(t.email)],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: userRoleEnum('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

/** Vermieterprofil inkl. Stripe-Connect-Konto. Existiert erst, wenn jemand Vermieter wird. */
export const hostProfiles = pgTable('host_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  stripeAccountId: text('stripe_account_id').unique(),
  onboardingStatus: hostOnboardingStatusEnum('onboarding_status').notNull().default('NOT_STARTED'),
  chargesEnabled: boolean('charges_enabled').notNull().default(false),
  payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
  /** Vorbereitung für Abos professioneller Vermieter / Gebührenstufen. */
  tier: text('tier').notNull().default('STANDARD'),
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }).notNull(),
  ...timestamps,
});

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    platform: platformEnum('platform').notNull(),
    ...timestamps,
  },
  (t) => [index('push_tokens_user_idx').on(t.userId)],
);
