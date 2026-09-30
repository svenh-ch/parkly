import { boolean, check, index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { countryCode, createdAt, currencyCode, id, point, timestamps } from './_shared';

/**
 * Regionen (Zürich, Zug, Luzern, ...). Nichts im Code ist auf Zürich fest verdrahtet;
 * Währung, Zeitzone und Gebühren hängen an der Region.
 */
export const regions = pgTable('regions', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  countryCode: countryCode('country_code').notNull(),
  currency: currencyCode('currency').notNull(),
  timezone: text('timezone').notNull(),
  center: point('center').notNull(),
  minLat: numeric('min_lat', { precision: 9, scale: 6 }).notNull(),
  minLng: numeric('min_lng', { precision: 9, scale: 6 }).notNull(),
  maxLat: numeric('max_lat', { precision: 9, scale: 6 }).notNull(),
  maxLng: numeric('max_lng', { precision: 9, scale: 6 }).notNull(),
  isActive: boolean('is_active').notNull().default(false),
  ...timestamps,
});

/**
 * Konfigurierbare Plattformgebühren. Die gültige Regel wird bei der Buchung ermittelt
 * und als Snapshot in der Buchung gespeichert (fee_bps), damit spätere Änderungen
 * bestehende Buchungen nicht verändern.
 */
export const platformFeeRules = pgTable(
  'platform_fee_rules',
  {
    id: id(),
    regionId: uuid('region_id').references(() => regions.id),
    hostTier: text('host_tier'),
    /** Anteil, den die Plattform vom Vermieter einbehält, in Basispunkten (1500 = 15 %). */
    hostFeeBps: integer('host_fee_bps').notNull(),
    /** Optionale Servicegebühr, die zusätzlich vom Mieter bezahlt wird. */
    renterFeeBps: integer('renter_fee_bps').notNull().default(0),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check('fee_rules_host_bps_range', sql`${t.hostFeeBps} between 0 and 10000`),
    check('fee_rules_renter_bps_range', sql`${t.renterFeeBps} between 0 and 10000`),
    index('fee_rules_lookup_idx').on(t.regionId, t.hostTier, t.validFrom),
  ],
);

export const addresses = pgTable(
  'addresses',
  {
    id: id(),
    street: text('street').notNull(),
    houseNumber: text('house_number'),
    postalCode: text('postal_code').notNull(),
    city: text('city').notNull(),
    /** Kanton / Bundesland */
    subdivision: text('subdivision'),
    countryCode: countryCode('country_code').notNull(),
    location: point('location').notNull(),
    ...timestamps,
  },
  (t) => [index('addresses_location_gix').using('gist', t.location)],
);
