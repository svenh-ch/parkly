import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, currencyCode, id, point, timestamps } from './_shared';
import { cancellationPolicyEnum, imageKindEnum, imageStatusEnum, spotStatusEnum, spotTypeEnum } from './enums';
import { addresses, regions } from './geo';
import { users } from './users';

/**
 * PRIVATE_MARKETPLACE_PARKING: von Vermietern erstellte, buchbare Parkplätze.
 */
export const parkingSpots = pgTable(
  'parking_spots',
  {
    id: id(),
    hostId: uuid('host_id')
      .notNull()
      .references(() => users.id),
    regionId: uuid('region_id')
      .notNull()
      .references(() => regions.id),
    addressId: uuid('address_id')
      .notNull()
      .references(() => addresses.id),
    /** Exakte Position: nur für den Vermieter und bestätigte Mieter sichtbar. */
    location: point('location').notNull(),
    /** Verschobene Position (~200 m) für die öffentliche Anzeige vor der Buchung. */
    approxLocation: point('approx_location').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    spotType: spotTypeEnum('spot_type').notNull(),
    status: spotStatusEnum('status').notNull().default('DRAFT'),
    /** z. B. "-2" oder "EG" */
    floor: text('floor'),
    /** Platznummer vor Ort, z. B. "17" */
    spotNumber: text('spot_number'),
    /** Erlaubte Fahrzeuge: MOTORCYCLE, SMALL_CAR, CAR, SUV, VAN */
    vehicleTypes: text('vehicle_types').array().notNull().default(sql`'{CAR}'::text[]`),
    /** Ausstattung: LIGHTING, CCTV, GATE, WIDE, EASY_ACCESS, … */
    amenities: text('amenities').array().notNull().default(sql`'{}'::text[]`),
    isCovered: boolean('is_covered').notNull().default(false),
    hasEvCharging: boolean('has_ev_charging').notNull().default(false),
    evConnector: text('ev_connector'),
    evPowerKw: numeric('ev_power_kw', { precision: 5, scale: 1 }),
    /** Zugang: OPEN, KEY, REMOTE, CODE, CARD, APP */
    accessMethod: text('access_method').notNull().default('OPEN'),
    /** Vorlaufzeit: so viele Minuten vor Beginn muss spätestens gebucht werden. */
    leadTimeMinutes: integer('lead_time_minutes').notNull().default(60),
    /** Vermieter hat bestätigt, dass er vermieten darf (Eigentümer oder mit Zustimmung). */
    rightsConfirmedAt: timestamp('rights_confirmed_at', { withTimezone: true }),
    access24h: boolean('access_24h').notNull().default(false),
    maxLengthCm: integer('max_length_cm'),
    maxWidthCm: integer('max_width_cm'),
    maxHeightCm: integer('max_height_cm'),
    /** Wird erst nach bestätigter Buchung an den Mieter ausgeliefert. */
    accessInstructions: text('access_instructions'),
    rules: text('rules'),
    // Preise in Rappen, null = Einheit nicht angeboten
    priceHourly: integer('price_hourly'),
    priceDaily: integer('price_daily'),
    priceWeekly: integer('price_weekly'),
    priceMonthly: integer('price_monthly'),
    currency: currencyCode('currency').notNull(),
    minDurationMinutes: integer('min_duration_minutes').notNull().default(60),
    maxDurationMinutes: integer('max_duration_minutes')
      .notNull()
      .default(90 * 24 * 60),
    cancellationPolicy: cancellationPolicyEnum('cancellation_policy').notNull().default('MODERATE'),
    instantBook: boolean('instant_book').notNull().default(true),
    /** Denormalisiert, wird beim Schreiben einer Bewertung aktualisiert. */
    ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }),
    ratingCount: integer('rating_count').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check(
      'spots_has_price',
      sql`coalesce(${t.priceHourly}, ${t.priceDaily}, ${t.priceWeekly}, ${t.priceMonthly}) is not null or ${t.status} = 'DRAFT'`,
    ),
    check(
      'spots_prices_positive',
      sql`coalesce(${t.priceHourly}, 1) > 0 and coalesce(${t.priceDaily}, 1) > 0 and coalesce(${t.priceWeekly}, 1) > 0 and coalesce(${t.priceMonthly}, 1) > 0`,
    ),
    check('spots_lead_time_range', sql`${t.leadTimeMinutes} between 0 and 10080`),
    check('spots_duration_range', sql`${t.minDurationMinutes} > 0 and ${t.maxDurationMinutes} >= ${t.minDurationMinutes}`),
    index('spots_approx_location_gix').using('gist', t.approxLocation),
    index('spots_region_status_idx').on(t.regionId, t.status),
    index('spots_host_idx').on(t.hostId),
  ],
);

/** Bilder liegen im Cloud Storage; hier nur Metadaten und der Storage-Key. */
export const images = pgTable(
  'images',
  {
    id: id(),
    spotId: uuid('spot_id')
      .notNull()
      .references(() => parkingSpots.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    storageKey: text('storage_key').notNull().unique(),
    kind: imageKindEnum('kind').notNull().default('OTHER'),
    position: smallint('position').notNull().default(0),
    width: integer('width'),
    height: integer('height'),
    bytes: integer('bytes'),
    mimeType: text('mime_type'),
    status: imageStatusEnum('status').notNull().default('PENDING_UPLOAD'),
    ...timestamps,
  },
  (t) => [index('images_spot_position_idx').on(t.spotId, t.position)],
);

/** Wiederkehrende Verfügbarkeit, z. B. Mo–Fr 07:00–19:00 (Ortszeit der Region). */
export const availabilityRules = pgTable(
  'availability_rules',
  {
    id: id(),
    spotId: uuid('spot_id')
      .notNull()
      .references(() => parkingSpots.id, { onDelete: 'cascade' }),
    /** ISO-Wochentag 1 = Montag … 7 = Sonntag */
    weekday: smallint('weekday').notNull(),
    /** Minuten ab Mitternacht, [start, end) */
    startMinute: smallint('start_minute').notNull(),
    endMinute: smallint('end_minute').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('availability_weekday_range', sql`${t.weekday} between 1 and 7`),
    check(
      'availability_minutes_range',
      sql`${t.startMinute} >= 0 and ${t.endMinute} <= 1440 and ${t.endMinute} > ${t.startMinute}`,
    ),
    index('availability_rules_spot_idx').on(t.spotId),
  ],
);

/** Einmalige Sperrungen (Ferien, Eigenbedarf) oder zusätzliche Freigaben. */
export const availabilityExceptions = pgTable(
  'availability_exceptions',
  {
    id: id(),
    spotId: uuid('spot_id')
      .notNull()
      .references(() => parkingSpots.id, { onDelete: 'cascade' }),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    isBlocked: boolean('is_blocked').notNull().default(true),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    check('availability_exceptions_range', sql`${t.endAt} > ${t.startAt}`),
    index('availability_exceptions_spot_idx').on(t.spotId, t.startAt),
  ],
);
