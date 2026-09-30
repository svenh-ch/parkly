/**
 * Zentrale Enums. Werden 1:1 als PostgreSQL-Enums verwendet (apps/api/src/db/schema)
 * und von allen Clients geteilt. Werte nie umbenennen, nur ergänzen.
 */

export const USER_ROLES = ['RENTER', 'HOST', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DELETED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Quelle eines Kartenobjekts: importiert (öffentlich) oder von Nutzern erstellt (Marketplace). */
export const PARKING_KINDS = ['PUBLIC_PARKING', 'PRIVATE_MARKETPLACE_PARKING'] as const;
export type ParkingKind = (typeof PARKING_KINDS)[number];

export const SPOT_TYPES = ['OUTDOOR', 'CARPORT', 'GARAGE', 'UNDERGROUND'] as const;
export type SpotType = (typeof SPOT_TYPES)[number];

export const SPOT_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'SUSPENDED'] as const;
export type SpotStatus = (typeof SPOT_STATUSES)[number];

export const IMAGE_KINDS = ['FRONT', 'TOP', 'ACCESS', 'SURROUNDINGS', 'GARAGE', 'ENTRANCE', 'OTHER'] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

export const IMAGE_STATUSES = ['PENDING_UPLOAD', 'READY', 'REJECTED'] as const;
export type ImageStatus = (typeof IMAGE_STATUSES)[number];

export const CANCELLATION_POLICIES = ['FLEXIBLE', 'MODERATE', 'STRICT'] as const;
export type CancellationPolicy = (typeof CANCELLATION_POLICIES)[number];

/**
 * Gespeicherter Buchungsstatus. "Bevorstehend" und "aktiv" werden aus CONFIRMED + Zeit
 * abgeleitet (siehe deriveBookingPhase), damit kein Cronjob Zustände nachführen muss.
 */
/** PENDING_APPROVAL: bezahlt, wartet auf Bestätigung des Vermieters (Buchung auf Anfrage). */
export const BOOKING_STATUSES = ['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'COMPLETED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Status, die einen Zeitraum blockieren (muss mit dem Exclusion Constraint übereinstimmen). */
export const BLOCKING_BOOKING_STATUSES = ['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED'] as const satisfies readonly BookingStatus[];

export const PAYMENT_STATUSES = [
  'REQUIRES_PAYMENT',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const REFUND_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const PAYOUT_STATUSES = ['PENDING', 'IN_TRANSIT', 'PAID', 'FAILED', 'CANCELED'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const HOST_ONBOARDING_STATUSES = ['NOT_STARTED', 'PENDING', 'COMPLETE', 'RESTRICTED'] as const;
export type HostOnboardingStatus = (typeof HOST_ONBOARDING_STATUSES)[number];

export const REVIEW_STATUSES = ['VISIBLE', 'HIDDEN'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REPORT_TARGETS = ['USER', 'SPOT', 'REVIEW', 'BOOKING'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const FACILITY_STATUSES = ['OPEN', 'CLOSED', 'UNKNOWN'] as const;
export type FacilityStatus = (typeof FACILITY_STATUSES)[number];

export const PRICE_UNITS = ['HOUR', 'DAY', 'WEEK', 'MONTH'] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export const PLATFORMS = ['IOS', 'ANDROID', 'WEB'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const CURRENCY_CODES = ['CHF', 'EUR'] as const;

/** Treueprogramm: Stufen aufsteigend. */
export const LOYALTY_TIERS = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'] as const;
export type LoyaltyTier = (typeof LOYALTY_TIERS)[number];
