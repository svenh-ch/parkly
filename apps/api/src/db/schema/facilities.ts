import {
  boolean,
  date,
  smallint,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { currencyCode, id, point, timestamps } from './_shared';
import { facilityStatusEnum, priceUnitEnum } from './enums';
import { regions } from './geo';

/**
 * PUBLIC_PARKING: öffentliche Parkhäuser und Parkplätze aus externen Quellen.
 * Strikt getrennt von parking_spots (Marketplace), da Herkunft, Lebenszyklus,
 * Lizenz und Buchbarkeit grundverschieden sind.
 */

export const dataSources = pgTable('data_sources', {
  id: id(),
  key: text('key').notNull().unique(), // z. B. "zh_ogd_parkhaeuser", "zh_pls", "osm"
  name: text('name').notNull(),
  license: text('license').notNull(), // z. B. "CC0-1.0", "ODbL-1.0"
  attribution: text('attribution'), // Pflichtangabe in der App, falls nötig
  url: text('url'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  ...timestamps,
});

export const parkingFacilities = pgTable(
  'parking_facilities',
  {
    id: id(),
    regionId: uuid('region_id')
      .notNull()
      .references(() => regions.id),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => dataSources.id),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    operator: text('operator'),
    facilityType: text('facility_type').notNull().default('GARAGE'), // GARAGE | LOT | STREET
    street: text('street'),
    postalCode: text('postal_code'),
    city: text('city'),
    location: point('location').notNull(),
    capacity: integer('capacity'),
    /** OSM-Syntax, z. B. "Mo-Su 00:00-24:00" */
    openingHours: text('opening_hours'),
    hasEvCharging: boolean('has_ev_charging'),
    maxHeightCm: integer('max_height_cm'),
    website: text('website'),
    isActive: boolean('is_active').notNull().default(true),
    /** Zeitpunkt der letzten manuellen Prüfung (Tarife/Öffnungszeiten). */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /** Originalattribute der Quelle zur Nachvollziehbarkeit. */
    sourceAttributes: jsonb('source_attributes'),
    /** Denormalisiert, wird beim Schreiben einer Bewertung aktualisiert. */
    ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }),
    ratingCount: integer('rating_count').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('facilities_source_external_uq').on(t.sourceId, t.externalId),
    index('facilities_location_gix').using('gist', t.location),
    index('facilities_region_idx').on(t.regionId, t.isActive),
  ],
);

export const facilityTariffs = pgTable(
  'facility_tariffs',
  {
    id: id(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => parkingFacilities.id, { onDelete: 'cascade' }),
    label: text('label').notNull(), // z. B. "Tagestarif 07–19 Uhr"
    amount: integer('amount').notNull(),
    currency: currencyCode('currency').notNull(),
    unit: priceUnitEnum('unit').notNull(),
    notes: text('notes'),
    /** Stand der Angabe ("Stand vom"), Pflicht bei manuell erfassten Tarifen. */
    asOf: date('as_of', { mode: 'string' }),
    /** Wo der Tarif nachgeprüft werden kann (Betreiber-Website, offene Daten). */
    sourceUrl: text('source_url'),
    position: smallint('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('facility_tariffs_facility_idx').on(t.facilityId)],
);

/** Nur der letzte bekannte Wert; Historie liegt bei ParkenDD. */
export const facilityOccupancy = pgTable('facility_occupancy', {
  facilityId: uuid('facility_id')
    .primaryKey()
    .references(() => parkingFacilities.id, { onDelete: 'cascade' }),
  freeSpaces: integer('free_spaces'),
  status: facilityStatusEnum('status').notNull().default('UNKNOWN'),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
