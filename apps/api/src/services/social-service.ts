import { and, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type {
  FavoriteItem,
  FavoriteTarget,
  MyReview,
  ParkingKind,
  ReportReviewInput,
  Review,
  ReviewList,
  UpsertReviewInput,
} from '@parking/shared';
import type { Database } from '../db/client';
import { auditLogs, favorites, parkingFacilities, parkingSpots, reports, reviews, users } from '../db/schema';
import { AppError } from '../lib/errors';
import type { MapService, Row } from './map-service';

/** "Anna M." — nie der volle Nachname (Datenschutz). */
function authorName(u: { firstName: string | null; lastName: string | null; status: string }): string {
  if (u.status === 'DELETED') return 'Ehemaliges Mitglied';
  const first = u.firstName?.trim();
  if (!first) return 'Mitglied';
  const initial = u.lastName?.trim()?.[0];
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

export class SocialService {
  constructor(
    private readonly db: Database,
    private readonly map: MapService,
  ) {}

  /* ─────────────── Favoriten ─────────────── */

  private async assertTargetExists(target: FavoriteTarget, userId: string) {
    if (target.kind === 'PUBLIC_PARKING') {
      const [f] = await this.db
        .select({ id: parkingFacilities.id })
        .from(parkingFacilities)
        .where(and(eq(parkingFacilities.id, target.id), eq(parkingFacilities.isActive, true)));
      if (!f) throw AppError.notFound('Parkhaus nicht gefunden');
    } else {
      const [s] = await this.db
        .select({ id: parkingSpots.id, status: parkingSpots.status, hostId: parkingSpots.hostId })
        .from(parkingSpots)
        .where(eq(parkingSpots.id, target.id));
      if (!s || (s.status !== 'ACTIVE' && s.hostId !== userId)) throw AppError.notFound('Parkplatz nicht gefunden');
    }
  }

  async addFavorite(userId: string, target: FavoriteTarget): Promise<void> {
    await this.assertTargetExists(target, userId);
    await this.db
      .insert(favorites)
      .values({
        userId,
        facilityId: target.kind === 'PUBLIC_PARKING' ? target.id : null,
        spotId: target.kind === 'PRIVATE_MARKETPLACE_PARKING' ? target.id : null,
      })
      .onConflictDoNothing();
  }

  async removeFavorite(userId: string, target: FavoriteTarget): Promise<void> {
    const column = target.kind === 'PUBLIC_PARKING' ? favorites.facilityId : favorites.spotId;
    await this.db.delete(favorites).where(and(eq(favorites.userId, userId), eq(column, target.id)));
  }

  async listFavorites(userId: string, from?: { lat: number; lng: number }): Promise<FavoriteItem[]> {
    const origin = from ? sql`ST_SetSRID(ST_MakePoint(${from.lng}, ${from.lat}), 4326)` : undefined;
    const points = this.map.pointsSql({
      kinds: ['PUBLIC_PARKING', 'PRIVATE_MARKETPLACE_PARKING'],
      filter: () => sql`true`,
      userId,
      favorites: true,
      distanceFrom: origin,
    });
    const rows = await this.db.execute<Row & { saved_at: Date | string }>(sql`
      select p.*, fav.created_at as saved_at
      from (${points}) p
      join favorites fav on fav.user_id = ${userId}
        and (fav.facility_id = p.id or fav.spot_id = p.id)
      order by ${origin ? sql`p.distance asc` : sql`fav.created_at desc`}`);
    return rows.rows.map((r) => ({
      ...this.map.toItem(r),
      distanceMeters: r.distance === null ? null : Math.round(Number(r.distance)),
      savedAt: new Date(r.saved_at).toISOString(),
    }));
  }

  /* ─────────────── Bewertungen ─────────────── */

  private async recomputeRating(target: { kind: ParkingKind; id: string }, tx: Pick<Database, 'execute'> = this.db) {
    if (target.kind === 'PUBLIC_PARKING') {
      await tx.execute(sql`
        update parking_facilities f set
          rating_avg = s.avg, rating_count = s.cnt
        from (select round(avg(rating)::numeric, 2) as avg, count(*)::int as cnt
              from reviews where facility_id = ${target.id} and status = 'VISIBLE') s
        where f.id = ${target.id}`);
    } else {
      await tx.execute(sql`
        update parking_spots p set
          rating_avg = s.avg, rating_count = s.cnt
        from (select round(avg(rating)::numeric, 2) as avg, count(*)::int as cnt
              from reviews where spot_id = ${target.id} and status = 'VISIBLE') s
        where p.id = ${target.id}`);
    }
  }

  private toReview(
    r: { id: string; rating: number; comment: string | null; createdAt: Date; updatedAt: Date; authorId: string },
    u: { firstName: string | null; lastName: string | null; status: string },
    userId: string | null,
  ): Review {
    return {
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      authorName: authorName(u),
      isMine: r.authorId === userId,
    };
  }

  async listReviews(
    target: { kind: ParkingKind; id: string },
    userId: string | null,
    page: { limit: number; before?: string },
  ): Promise<ReviewList> {
    const targetCol = target.kind === 'PUBLIC_PARKING' ? reviews.facilityId : reviews.spotId;
    const select = {
      id: reviews.id,
      rating: reviews.rating,
      comment: reviews.comment,
      createdAt: reviews.createdAt,
      updatedAt: reviews.updatedAt,
      authorId: reviews.authorId,
      firstName: users.firstName,
      lastName: users.lastName,
      status: users.status,
    };
    const rows = await this.db
      .select(select)
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.authorId))
      .where(
        and(
          eq(targetCol, target.id),
          eq(reviews.status, 'VISIBLE'),
          page.before ? lt(reviews.createdAt, new Date(page.before)) : undefined,
        ),
      )
      .orderBy(desc(reviews.createdAt))
      .limit(page.limit + 1);

    let mine: Review | null = null;
    if (userId) {
      const [m] = await this.db
        .select(select)
        .from(reviews)
        .innerJoin(users, eq(users.id, reviews.authorId))
        .where(and(eq(targetCol, target.id), eq(reviews.authorId, userId)))
        .limit(1);
      if (m) mine = this.toReview(m, m, userId);
    }

    const pageRows = rows.slice(0, page.limit);
    return {
      items: pageRows.map((r) => this.toReview(r, r, userId)),
      nextCursor: rows.length > page.limit ? pageRows[pageRows.length - 1]!.createdAt.toISOString() : null,
      mine,
    };
  }

  /** Eigene Bewertung eines Parkhauses anlegen oder ändern (eine pro Nutzer und Parkhaus). */
  async upsertFacilityReview(userId: string, facilityId: string, input: UpsertReviewInput): Promise<Review> {
    await this.assertTargetExists({ kind: 'PUBLIC_PARKING', id: facilityId }, userId);
    const comment = input.comment ?? null;

    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(reviews)
        .values({ facilityId, authorId: userId, rating: input.rating, comment })
        .onConflictDoUpdate({
          target: [reviews.authorId, reviews.facilityId],
          targetWhere: isNotNull(reviews.facilityId),
          set: { rating: input.rating, comment, updatedAt: new Date() },
        })
        .returning({ id: reviews.id });
      await this.recomputeRating({ kind: 'PUBLIC_PARKING', id: facilityId }, tx);
      return row!.id;
    });

    const [r] = await this.db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
        updatedAt: reviews.updatedAt,
        authorId: reviews.authorId,
        firstName: users.firstName,
        lastName: users.lastName,
        status: users.status,
      })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.authorId))
      .where(eq(reviews.id, id));
    return this.toReview(r!, r!, userId);
  }

  async deleteFacilityReview(userId: string, facilityId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(reviews).where(and(eq(reviews.facilityId, facilityId), eq(reviews.authorId, userId)));
      await this.recomputeRating({ kind: 'PUBLIC_PARKING', id: facilityId }, tx);
    });
  }

  async myReviews(userId: string): Promise<MyReview[]> {
    const rows = await this.db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
        status: reviews.status,
        facilityId: reviews.facilityId,
        facilityName: parkingFacilities.name,
        spotId: reviews.spotId,
        spotTitle: parkingSpots.title,
      })
      .from(reviews)
      .leftJoin(parkingFacilities, eq(parkingFacilities.id, reviews.facilityId))
      .leftJoin(parkingSpots, eq(parkingSpots.id, reviews.spotId))
      .where(eq(reviews.authorId, userId))
      .orderBy(desc(reviews.createdAt));
    return rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      status: r.status,
      target: r.facilityId
        ? { kind: 'PUBLIC_PARKING' as const, id: r.facilityId, name: r.facilityName ?? 'Parkhaus' }
        : { kind: 'PRIVATE_MARKETPLACE_PARKING' as const, id: r.spotId!, name: r.spotTitle ?? 'Parkplatz' },
    }));
  }

  async reportReview(userId: string, reviewId: string, input: ReportReviewInput): Promise<void> {
    const [r] = await this.db.select({ authorId: reviews.authorId }).from(reviews).where(eq(reviews.id, reviewId));
    if (!r) throw AppError.notFound('Bewertung nicht gefunden');
    if (r.authorId === userId) throw AppError.validation('Eigene Bewertungen kannst du bearbeiten oder löschen.');
    const [existing] = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.reporterId, userId),
          eq(reports.targetType, 'REVIEW'),
          eq(reports.targetId, reviewId),
          inArray(reports.status, ['OPEN', 'IN_REVIEW']),
        ),
      );
    if (existing) return; // idempotent: schon gemeldet
    await this.db.insert(reports).values({
      reporterId: userId,
      targetType: 'REVIEW',
      targetId: reviewId,
      reason: input.reason,
      details: input.details ?? null,
    });
  }

  /** Admin: Bewertung ausblenden oder wieder einblenden. */
  async moderateReview(adminId: string, reviewId: string, status: 'VISIBLE' | 'HIDDEN'): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [r] = await tx
        .update(reviews)
        .set({ status })
        .where(eq(reviews.id, reviewId))
        .returning({ facilityId: reviews.facilityId, spotId: reviews.spotId });
      if (!r) throw AppError.notFound('Bewertung nicht gefunden');
      await this.recomputeRating(
        r.facilityId ? { kind: 'PUBLIC_PARKING', id: r.facilityId } : { kind: 'PRIVATE_MARKETPLACE_PARKING', id: r.spotId! },
        tx,
      );
      await tx.insert(auditLogs).values({
        actorId: adminId,
        action: status === 'HIDDEN' ? 'REVIEW_HIDDEN' : 'REVIEW_SHOWN',
        entityType: 'review',
        entityId: reviewId,
      });
    });
  }
}
