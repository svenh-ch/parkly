import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestamps } from './_shared';
import { reportStatusEnum, reportTargetEnum, reviewStatusEnum } from './enums';
import { bookings } from './bookings';
import { parkingFacilities } from './facilities';
import { parkingSpots } from './spots';
import { users } from './users';

/**
 * Bewertungen für zwei Ziele:
 *  - private Parkplätze: nur mit eigener, abgeschlossener Buchung (genau eine pro Buchung)
 *  - öffentliche Parkhäuser: eine Bewertung pro Nutzer und Parkhaus, änderbar
 */
export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .unique()
      .references(() => bookings.id),
    spotId: uuid('spot_id').references(() => parkingSpots.id),
    facilityId: uuid('facility_id').references(() => parkingFacilities.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    rating: smallint('rating').notNull(),
    comment: text('comment'),
    hostReply: text('host_reply'),
    status: reviewStatusEnum('status').notNull().default('VISIBLE'),
    ...timestamps,
  },
  (t) => [
    check('reviews_rating_range', sql`${t.rating} between 1 and 5`),
    check('reviews_one_target', sql`num_nonnulls(${t.spotId}, ${t.facilityId}) = 1`),
    check('reviews_spot_requires_booking', sql`${t.spotId} is null or ${t.bookingId} is not null`),
    check('reviews_comment_length', sql`${t.comment} is null or char_length(${t.comment}) <= 1000`),
    index('reviews_spot_idx').on(t.spotId, t.createdAt),
    index('reviews_facility_idx').on(t.facilityId, t.createdAt),
    index('reviews_author_idx').on(t.authorId, t.createdAt),
    uniqueIndex('reviews_author_facility_uq')
      .on(t.authorId, t.facilityId)
      .where(sql`${t.facilityId} is not null`),
  ],
);

/** Favoriten zeigen entweder auf einen Marketplace-Parkplatz oder ein Parkhaus. */
export const favorites = pgTable(
  'favorites',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    spotId: uuid('spot_id').references(() => parkingSpots.id, { onDelete: 'cascade' }),
    facilityId: uuid('facility_id').references(() => parkingFacilities.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('favorites_one_target', sql`num_nonnulls(${t.spotId}, ${t.facilityId}) = 1`),
    uniqueIndex('favorites_user_spot_uq')
      .on(t.userId, t.spotId)
      .where(sql`${t.spotId} is not null`),
    uniqueIndex('favorites_user_facility_uq')
      .on(t.userId, t.facilityId)
      .where(sql`${t.facilityId} is not null`),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // BOOKING_CONFIRMED, BOOKING_REMINDER, REVIEW_REQUEST, ...
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

/** Meldungen (Missbrauch, falsche Angaben, besetzter Parkplatz) für die Admin-Moderation. */
export const reports = pgTable(
  'reports',
  {
    id: id(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id),
    targetType: reportTargetEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    reason: text('reason').notNull(),
    details: text('details'),
    status: reportStatusEnum('status').notNull().default('OPEN'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('reports_status_idx').on(t.status, t.createdAt)],
);

/** Nachvollziehbarkeit sicherheitsrelevanter Aktionen (Admin, Rollen, Stornos, Refunds). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    metadata: jsonb('metadata'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_entity_idx').on(t.entityType, t.entityId)],
);
