import { z } from 'zod';
import { CANCELLATION_POLICIES, CURRENCY_CODES, IMAGE_KINDS, IMAGE_STATUSES, SPOT_STATUSES, SPOT_TYPES } from '../enums';
import { ratingSummarySchema } from './map';

/**
 * Private Parkplätze (Marketplace): Inserieren, Fotos, öffentliche Detailseite.
 * Preise immer in Rappen (ganze Zahlen), Zeiten in Minuten.
 */

export const VEHICLE_TYPES = ['MOTORCYCLE', 'SMALL_CAR', 'CAR', 'SUV', 'VAN'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const AMENITIES = ['LIGHTING', 'CCTV', 'GATE', 'WIDE', 'EASY_ACCESS', 'NEAR_TRANSIT'] as const;
export type Amenity = (typeof AMENITIES)[number];

export const ACCESS_METHODS = ['OPEN', 'KEY', 'REMOTE', 'CODE', 'CARD', 'APP'] as const;
export type AccessMethod = (typeof ACCESS_METHODS)[number];

export const EV_CONNECTORS = ['TYPE2', 'CCS', 'CHADEMO', 'SCHUKO', 'CEE'] as const;
export type EvConnector = (typeof EV_CONNECTORS)[number];

/** Erlaubte Bildformate und -grösse (serverseitig geprüft). */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const SPOT_MIN_IMAGES = 3;
export const SPOT_MAX_IMAGES = 10;

const rappen = z.number().int().min(100, 'Mindestens CHF 1').max(1_000_000, 'Höchstens CHF 10’000');
const cm = (min: number, max: number) => z.number().int().min(min).max(max);

export const availabilityRuleSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((r) => r.endMinute > r.startMinute, { message: 'Ende muss nach dem Beginn liegen', path: ['endMinute'] });
export type AvailabilityRule = z.infer<typeof availabilityRuleSchema>;

export const spotAddressSchema = z.object({
  street: z.string().trim().min(2).max(120),
  houseNumber: z.string().trim().max(12).nullable(),
  postalCode: z.string().trim().regex(/^\d{4}$/, 'PLZ mit 4 Ziffern'),
  city: z.string().trim().min(2).max(80),
});
export type SpotAddress = z.infer<typeof spotAddressSchema>;

/** Genaue Position: nur Schweiz. */
export const swissPointSchema = z.object({
  lat: z.number().min(45.8).max(47.85),
  lng: z.number().min(5.9).max(10.55),
});

export const spotPricesSchema = z.object({
  hourly: rappen.nullable(),
  daily: rappen.nullable(),
  weekly: rappen.nullable(),
  monthly: rappen.nullable(),
});
export type SpotPrices = z.infer<typeof spotPricesSchema>;

/** Alle änderbaren Felder; beim Anlegen sind Adresse und Position Pflicht. */
export const spotFieldsSchema = z.object({
  address: spotAddressSchema,
  location: swissPointSchema,
  floor: z.string().trim().max(10).nullable(),
  spotNumber: z.string().trim().max(12).nullable(),
  spotType: z.enum(SPOT_TYPES),
  isCovered: z.boolean(),
  vehicleTypes: z.array(z.enum(VEHICLE_TYPES)).min(1, 'Mindestens ein Fahrzeugtyp').max(VEHICLE_TYPES.length),
  maxLengthCm: cm(200, 2000).nullable(),
  maxWidthCm: cm(120, 500).nullable(),
  maxHeightCm: cm(150, 500).nullable(),
  amenities: z.array(z.enum(AMENITIES)).max(AMENITIES.length),
  hasEvCharging: z.boolean(),
  evConnector: z.enum(EV_CONNECTORS).nullable(),
  evPowerKw: z.number().min(1).max(350).nullable(),
  accessMethod: z.enum(ACCESS_METHODS),
  access24h: z.boolean(),
  /** Nur nach bestätigter Buchung für den Mieter sichtbar. */
  accessInstructions: z.string().trim().max(1000).nullable(),
  title: z.string().trim().min(5, 'Mindestens 5 Zeichen').max(80),
  description: z.string().trim().max(2000),
  rules: z.string().trim().max(1000).nullable(),
  prices: spotPricesSchema,
  minDurationMinutes: z.number().int().min(15).max(525_600),
  maxDurationMinutes: z.number().int().min(15).max(525_600),
  leadTimeMinutes: z.number().int().min(0).max(10_080),
  instantBook: z.boolean(),
  cancellationPolicy: z.enum(CANCELLATION_POLICIES),
  rightsConfirmed: z.boolean(),
});

export const createSpotSchema = spotFieldsSchema
  .partial()
  .required({ address: true, location: true })
  .extend({ title: z.string().trim().max(80).optional() });
export type CreateSpotInput = z.infer<typeof createSpotSchema>;

export const updateSpotSchema = spotFieldsSchema.partial().extend({ title: z.string().trim().max(80).optional() });
export type UpdateSpotInput = z.infer<typeof updateSpotSchema>;

export const spotAvailabilityInputSchema = z.object({
  access24h: z.boolean(),
  rules: z.array(availabilityRuleSchema).max(50),
});
export type SpotAvailabilityInput = z.infer<typeof spotAvailabilityInputSchema>;

export const spotImageSchema = z.object({
  id: z.uuid(),
  kind: z.enum(IMAGE_KINDS),
  position: z.number().int(),
  status: z.enum(IMAGE_STATUSES),
  /** Zeitlich begrenzte, signierte URL (nur bei status READY). */
  url: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type SpotImage = z.infer<typeof spotImageSchema>;

/** Was zum Veröffentlichen noch fehlt (leer = bereit). */
export const PUBLISH_ISSUES = ['TITLE', 'PRICE', 'IMAGES', 'AVAILABILITY', 'RIGHTS', 'DURATION'] as const;
export type PublishIssue = (typeof PUBLISH_ISSUES)[number];

export const hostSpotSchema = z.object({
  id: z.uuid(),
  status: z.enum(SPOT_STATUSES),
  title: z.string(),
  description: z.string(),
  address: spotAddressSchema,
  location: z.object({ lat: z.number(), lng: z.number() }),
  approxLocation: z.object({ lat: z.number(), lng: z.number() }),
  floor: z.string().nullable(),
  spotNumber: z.string().nullable(),
  spotType: z.enum(SPOT_TYPES),
  isCovered: z.boolean(),
  vehicleTypes: z.array(z.enum(VEHICLE_TYPES)),
  maxLengthCm: z.number().int().nullable(),
  maxWidthCm: z.number().int().nullable(),
  maxHeightCm: z.number().int().nullable(),
  amenities: z.array(z.enum(AMENITIES)),
  hasEvCharging: z.boolean(),
  evConnector: z.enum(EV_CONNECTORS).nullable(),
  evPowerKw: z.number().nullable(),
  accessMethod: z.enum(ACCESS_METHODS),
  access24h: z.boolean(),
  accessInstructions: z.string().nullable(),
  rules: z.string().nullable(),
  prices: z.object({ hourly: z.number().int().nullable(), daily: z.number().int().nullable(), weekly: z.number().int().nullable(), monthly: z.number().int().nullable() }),
  currency: z.enum(CURRENCY_CODES),
  minDurationMinutes: z.number().int(),
  maxDurationMinutes: z.number().int(),
  leadTimeMinutes: z.number().int(),
  instantBook: z.boolean(),
  cancellationPolicy: z.enum(CANCELLATION_POLICIES),
  rightsConfirmed: z.boolean(),
  availability: z.array(z.object({ weekday: z.number().int(), startMinute: z.number().int(), endMinute: z.number().int() })),
  images: z.array(spotImageSchema),
  publishIssues: z.array(z.enum(PUBLISH_ISSUES)),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type HostSpot = z.infer<typeof hostSpotSchema>;

export const hostSpotListItemSchema = hostSpotSchema.pick({
  id: true,
  status: true,
  title: true,
  address: true,
  prices: true,
  currency: true,
  publishIssues: true,
  updatedAt: true,
}).extend({ coverUrl: z.string().nullable(), imageCount: z.number().int() });
export type HostSpotListItem = z.infer<typeof hostSpotListItemSchema>;
export const hostSpotListSchema = z.object({ items: z.array(hostSpotListItemSchema) });

export const hostFeeSchema = z.object({ hostFeeBps: z.number().int(), renterFeeBps: z.number().int() });
export type HostFee = z.infer<typeof hostFeeSchema>;

export const requestImageUploadSchema = z.object({
  kind: z.enum(IMAGE_KINDS),
  mimeType: z.enum(IMAGE_MIME_TYPES),
  bytes: z.number().int().min(1).max(IMAGE_MAX_BYTES, 'Bild ist grösser als 10 MB'),
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
});
export type RequestImageUploadInput = z.infer<typeof requestImageUploadSchema>;

export const imageUploadTicketSchema = z.object({
  image: spotImageSchema,
  upload: z.object({ url: z.string(), method: z.literal('PUT'), headers: z.record(z.string(), z.string()) }),
});
export type ImageUploadTicket = z.infer<typeof imageUploadTicketSchema>;

export const reorderImagesSchema = z.object({
  /** Neue Reihenfolge; das erste Bild ist das Titelbild. */
  items: z.array(z.object({ id: z.uuid(), kind: z.enum(IMAGE_KINDS) })).min(1).max(SPOT_MAX_IMAGES),
});
export type ReorderImagesInput = z.infer<typeof reorderImagesSchema>;

/** Öffentliche Detailseite (ohne genaue Adresse, Platznummer und Zugangsinfos). */
export const spotDetailSchema = z.object({
  id: z.uuid(),
  kind: z.literal('PRIVATE_MARKETPLACE_PARKING'),
  title: z.string(),
  description: z.string(),
  area: z.string(),
  lat: z.number(),
  lng: z.number(),
  spotType: z.enum(SPOT_TYPES),
  floor: z.string().nullable(),
  isCovered: z.boolean(),
  vehicleTypes: z.array(z.enum(VEHICLE_TYPES)),
  maxLengthCm: z.number().int().nullable(),
  maxWidthCm: z.number().int().nullable(),
  maxHeightCm: z.number().int().nullable(),
  amenities: z.array(z.enum(AMENITIES)),
  hasEvCharging: z.boolean(),
  evConnector: z.enum(EV_CONNECTORS).nullable(),
  evPowerKw: z.number().nullable(),
  accessMethod: z.enum(ACCESS_METHODS),
  access24h: z.boolean(),
  rules: z.string().nullable(),
  prices: hostSpotSchema.shape.prices,
  currency: z.enum(CURRENCY_CODES),
  minDurationMinutes: z.number().int(),
  maxDurationMinutes: z.number().int(),
  leadTimeMinutes: z.number().int(),
  instantBook: z.boolean(),
  cancellationPolicy: z.enum(CANCELLATION_POLICIES),
  availability: hostSpotSchema.shape.availability,
  images: z.array(spotImageSchema),
  host: z.object({ firstName: z.string().nullable() }),
  rating: ratingSummarySchema,
  isFavorite: z.boolean(),
  isOwn: z.boolean(),
});
export type SpotDetail = z.infer<typeof spotDetailSchema>;

/** Auszahlung nach Plattformgebühr, auf Rappen gerundet. */
export function hostPayout(amount: number, hostFeeBps: number): number {
  return Math.max(0, Math.round((amount * (10_000 - hostFeeBps)) / 10_000));
}
