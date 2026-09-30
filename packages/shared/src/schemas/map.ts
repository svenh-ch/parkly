import { z } from 'zod';
import { CURRENCY_CODES, FACILITY_STATUSES, PARKING_KINDS, PRICE_UNITS } from '../enums';

/** Anfrage für den sichtbaren Kartenausschnitt. */
export const mapQuerySchema = z.object({
  minLng: z.coerce.number().min(-540).max(540),
  minLat: z.coerce.number().min(-90).max(90),
  maxLng: z.coerce.number().min(-540).max(540),
  maxLat: z.coerce.number().min(-90).max(90),
  /** Web-Mercator-Zoomstufe (0 = ganze Welt, ~20 = Gebäude). */
  zoom: z.coerce.number().min(0).max(22),
  kinds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : [...PARKING_KINDS]))
    .pipe(z.array(z.enum(PARKING_KINDS)).min(1)),
  /** Nur Favoriten des eingeloggten Nutzers. */
  favoritesOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type MapQuery = z.infer<typeof mapQuerySchema>;

export const priceTagSchema = z.object({
  amount: z.number().int(),
  unit: z.enum(PRICE_UNITS),
  currency: z.enum(CURRENCY_CODES),
});
export type PriceTag = z.infer<typeof priceTagSchema>;

export const occupancySchema = z.object({
  freeSpaces: z.number().int().nullable(),
  status: z.enum(FACILITY_STATUSES),
  observedAt: z.string(),
  /** false, wenn der letzte Messwert zu alt ist, um ihn anzuzeigen. */
  isLive: z.boolean(),
});
export type Occupancy = z.infer<typeof occupancySchema>;

export const ratingSummarySchema = z.object({
  /** Durchschnitt 1–5, null ohne Bewertungen */
  avg: z.number().nullable(),
  count: z.number().int(),
});
export type RatingSummary = z.infer<typeof ratingSummarySchema>;

/** Ein Pin auf der Karte (öffentliches Parkhaus oder privater Marketplace-Parkplatz). */
export const mapItemSchema = z.object({
  kind: z.enum(PARKING_KINDS),
  id: z.uuid(),
  lat: z.number(),
  lng: z.number(),
  name: z.string(),
  capacity: z.number().int().nullable(),
  occupancy: occupancySchema.nullable(),
  price: priceTagSchema.nullable(),
  rating: ratingSummarySchema,
  /** Nur für eingeloggte Nutzer relevant, sonst immer false. */
  isFavorite: z.boolean(),
});
export type MapItem = z.infer<typeof mapItemSchema>;

/** Zusammengefasste Pins bei kleiner Zoomstufe. */
export const mapClusterSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  count: z.number().int().positive(),
});
export type MapCluster = z.infer<typeof mapClusterSchema>;

export const mapResponseSchema = z.object({
  mode: z.enum(['items', 'clusters']),
  /** Einzelne Pins. Im Cluster-Modus nur die Favoriten (werden nie geclustert). */
  items: z.array(mapItemSchema),
  clusters: z.array(mapClusterSchema),
  /** true, wenn nicht alle Treffer zurückgegeben wurden (zu grosser Ausschnitt). */
  truncated: z.boolean(),
});
export type MapResponse = z.infer<typeof mapResponseSchema>;

export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  /** Suchradius in Metern. Standard: die nächsten Treffer bis 200 km, damit Home nie leer ist. */
  radius: z.coerce.number().int().min(100).max(200_000).default(200_000),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  /** Gehdistanz zum Ort berechnen und danach sortieren (Ortssuche). */
  walk: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type NearbyQuery = z.infer<typeof nearbyQuerySchema>;

export const nearbyItemSchema = mapItemSchema.extend({
  distanceMeters: z.number().int(),
  /** Fussweg zum gesuchten Ort (nur mit walk=true und wenn der Dienst erreichbar ist). */
  walkMeters: z.number().int().nullable().optional(),
  walkSeconds: z.number().int().nullable().optional(),
});
export type NearbyItem = z.infer<typeof nearbyItemSchema>;
export const nearbyResponseSchema = z.object({ items: z.array(nearbyItemSchema) });

export const facilityDetailSchema = z.object({
  id: z.uuid(),
  kind: z.literal('PUBLIC_PARKING'),
  name: z.string(),
  operator: z.string().nullable(),
  facilityType: z.string(),
  street: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  capacity: z.number().int().nullable(),
  openingHours: z.string().nullable(),
  hasEvCharging: z.boolean().nullable(),
  maxHeightCm: z.number().int().nullable(),
  website: z.string().nullable(),
  occupancy: occupancySchema.nullable(),
  tariffs: z.array(
    z.object({
      label: z.string(),
      amount: z.number().int(),
      currency: z.enum(CURRENCY_CODES),
      unit: z.enum(PRICE_UNITS),
      notes: z.string().nullable(),
    }),
  ),
  /** "Stand vom" der Tarife (ISO-Datum) und wo man sie nachprüfen kann. */
  tariffsAsOf: z.string().nullable(),
  tariffsSourceUrl: z.string().nullable(),
  source: z.object({ name: z.string(), license: z.string(), attribution: z.string().nullable() }),
  rating: ratingSummarySchema,
  isFavorite: z.boolean(),
});
export type FacilityDetail = z.infer<typeof facilityDetailSchema>;

/* ─────────────── Ortssuche ("Wo möchtest du parken?") ─────────────── */

export const placeSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Mindestens 2 Zeichen').max(100),
  /** Optional: ungefähre Position (für bessere Reihenfolge), wird nicht gespeichert. */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

/** ADDRESS = Adresse, PLACE = Ort/Quartier/Gebäude, POI = Geschäft/Restaurant/Hotel usw., PARKING = unser Parkplatz */
export const PLACE_TYPES = ['ADDRESS', 'PLACE', 'POI', 'PARKING'] as const;

export const placeSuggestionSchema = z.object({
  id: z.string(),
  type: z.enum(PLACE_TYPES),
  label: z.string(),
  detail: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  /** Nur bei type = PARKING: direkt zum Parkhaus/Parkplatz */
  parking: z.object({ kind: z.enum(PARKING_KINDS), id: z.uuid() }).nullable(),
});
export type PlaceSuggestion = z.infer<typeof placeSuggestionSchema>;
export const placeSearchResponseSchema = z.object({ items: z.array(placeSuggestionSchema) });

/* ─────────────── Tarife pflegen (Admin) ─────────────── */

export const facilityTariffsInputSchema = z.object({
  asOf: z.iso.date(),
  sourceUrl: z.url().max(500).nullable(),
  items: z
    .array(
      z.object({
        label: z.string().trim().min(2).max(80),
        amount: z.number().int().min(0).max(100_000_00),
        unit: z.enum(PRICE_UNITS),
        notes: z.string().trim().max(200).nullable().optional(),
      }),
    )
    .max(20),
});
export type FacilityTariffsInput = z.infer<typeof facilityTariffsInputSchema>;
