import { boolean, index, integer, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, point, timestamps } from './_shared';
import { users } from './users';

/**
 * Treueprogramm. Stufen und ihre Vorteile liegen in der Datenbank und sind ohne
 * Code-Änderung anpassbar. Gebühren in Basispunkten (1000 = 10 %).
 */
export const loyaltyTiers = pgTable('loyalty_tiers', {
  tier: text('tier').primaryKey(), // BRONZE … DIAMOND
  rank: smallint('rank').notNull().unique(),
  minPoints: integer('min_points').notNull(),
  renterFeeBps: integer('renter_fee_bps').notNull(),
  hostFeeBps: integer('host_fee_bps').notNull(),
  /** Stunden, die man bei Events vor der öffentlichen Freigabe buchen darf. */
  earlyAccessHours: integer('early_access_hours').notNull().default(0),
  ...timestamps,
});

/** Erreichte Stufe pro Person; gilt nach dem Erreichen 12 Monate. */
export const userLoyalty = pgTable('user_loyalty', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  tier: text('tier').notNull().default('BRONZE'),
  points: integer('points').notNull().default(0),
  tierHeldUntil: timestamp('tier_held_until', { withTimezone: true }),
  ...timestamps,
});

/** Events mit gestaffeltem Vorkauf für Parkplätze im Umkreis. */
export const events = pgTable(
  'events',
  {
    id: id(),
    name: text('name').notNull(),
    location: point('location').notNull(),
    radiusMeters: integer('radius_meters').notNull().default(1500),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** Ab hier dürfen alle buchen; höhere Stufen entsprechend früher. */
    publicOpenAt: timestamp('public_open_at', { withTimezone: true }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('events_location_gix').using('gist', t.location), index('events_time_idx').on(t.startsAt)],
);
