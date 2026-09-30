import { z } from 'zod';
import { BOOKING_STATUSES, CANCELLATION_POLICIES, CURRENCY_CODES, LOYALTY_TIERS, PRICE_UNITS, type CancellationPolicy } from '../enums';
import { roundToFiveRappen, splitPlatformFee } from '../money';
import { BOOKING_STEP_MINUTES } from '../pricing/quote';

/* ─────────────── Verfügbarkeit ─────────────── */

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Wochentag (1 = Mo) und Minute des Tages in einer Zeitzone. */
export function localSlot(date: Date, timeZone: string): { weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return { weekday: WEEKDAY[get('weekday')] ?? 1, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

/**
 * Liegt [start, end) vollständig in den Verfügbarkeitsregeln? Geprüft in 15-Minuten-Schritten
 * in der Ortszeit der Region (Sommer-/Winterzeit inklusive).
 */
export function isWithinAvailability(
  rules: { weekday: number; startMinute: number; endMinute: number }[],
  access24h: boolean,
  start: Date,
  end: Date,
  timeZone = 'Europe/Zurich',
): boolean {
  if (access24h) return true;
  for (let t = start.getTime(); t < end.getTime(); t += BOOKING_STEP_MINUTES * 60_000) {
    const { weekday, minute } = localSlot(new Date(t), timeZone);
    const ok = rules.some((r) => r.weekday === weekday && r.startMinute <= minute && minute + BOOKING_STEP_MINUTES <= r.endMinute);
    if (!ok) return false;
  }
  return true;
}

/* ─────────────── Beträge ─────────────── */

/**
 * Beträge einer Buchung. Die Servicegebühr zahlt der Mieter zusätzlich, die Vermietergebühr
 * wird vom Mietpreis abgezogen. Beide hängen von der Treue-Stufe der jeweiligen Person ab.
 */
export function bookingAmounts(subtotal: number, renterFeeBps: number, hostFeeBps: number) {
  const renterFee = roundToFiveRappen((subtotal * renterFeeBps) / 10_000);
  const { platformFee, hostPayout } = splitPlatformFee(subtotal, hostFeeBps);
  return { subtotal, renterFee, total: subtotal + renterFee, platformFee, hostPayout };
}

/* ─────────────── Storno ─────────────── */

export const FREE_CANCELLATION_HOURS: Record<CancellationPolicy, number> = { FLEXIBLE: 1, MODERATE: 24, STRICT: 24 * 7 };

/**
 * Rückerstattung bei Storno. Vor der Frist: alles zurück (inkl. Servicegebühr).
 * Nach der Frist: nichts. Storniert der Vermieter, erhält der Mieter immer alles zurück.
 */
export function cancellationRefund(
  b: { total: number; startAt: Date; policy: CancellationPolicy; status: string },
  by: 'RENTER' | 'HOST' | 'SYSTEM',
  now = new Date(),
): { refund: number; free: boolean; deadline: Date } {
  const deadline = new Date(b.startAt.getTime() - FREE_CANCELLATION_HOURS[b.policy] * 3_600_000);
  if (by !== 'RENTER' || b.status === 'PENDING_APPROVAL') return { refund: b.total, free: true, deadline };
  const free = now.getTime() <= deadline.getTime();
  return { refund: free ? b.total : 0, free, deadline };
}

/* ─────────────── Schemas ─────────────── */

const isoDate = z.iso.datetime({ offset: true });

export const quoteRequestSchema = z.object({ startAt: isoDate, endAt: isoDate });
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export const eventAccessSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  publicOpenAt: z.string(),
  /** Ab wann diese Person buchen darf (Vorkauf je nach Stufe). */
  yourAccessAt: z.string(),
  canBookNow: z.boolean(),
});

export const quoteSchema = z.object({
  startAt: z.string(),
  endAt: z.string(),
  durationMinutes: z.number().int(),
  lines: z.array(z.object({ unit: z.enum(PRICE_UNITS), quantity: z.number(), unitPrice: z.number().int(), amount: z.number().int() })),
  subtotal: z.number().int(),
  renterFee: z.number().int(),
  renterFeeBps: z.number().int(),
  total: z.number().int(),
  currency: z.enum(CURRENCY_CODES),
  tier: z.enum(LOYALTY_TIERS),
  /** Ersparnis gegenüber Bronze (Rappen). */
  tierSavings: z.number().int(),
  instantBook: z.boolean(),
  cancellationPolicy: z.enum(CANCELLATION_POLICIES),
  freeCancellationUntil: z.string(),
  event: eventAccessSchema.nullable(),
});
export type BookingQuote = z.infer<typeof quoteSchema>;

export const createBookingSchema = z.object({ spotId: z.uuid(), startAt: isoDate, endAt: isoDate });
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const PAYMENT_PROVIDERS = ['stripe', 'dev'] as const;

/** Was die App zum Bezahlen braucht (Stripe PaymentSheet oder Testzahlung). */
export const paymentSessionSchema = z.object({
  provider: z.enum(PAYMENT_PROVIDERS),
  paymentId: z.uuid(),
  amount: z.number().int(),
  currency: z.enum(CURRENCY_CODES),
  clientSecret: z.string().nullable(),
  customerId: z.string().nullable(),
  ephemeralKey: z.string().nullable(),
  publishableKey: z.string().nullable(),
});
export type PaymentSession = z.infer<typeof paymentSessionSchema>;

export const bookingSchema = z.object({
  id: z.uuid(),
  status: z.enum(BOOKING_STATUSES),
  role: z.enum(['RENTER', 'HOST']),
  spot: z.object({
    id: z.uuid(),
    title: z.string(),
    coverUrl: z.string().nullable(),
    area: z.string(),
    /** Genaue Angaben nur für bestätigte Buchungen (und den Vermieter). */
    address: z.string().nullable(),
    lat: z.number(),
    lng: z.number(),
    floor: z.string().nullable(),
    spotNumber: z.string().nullable(),
    accessInstructions: z.string().nullable(),
    accessMethod: z.string(),
  }),
  counterpart: z.object({ firstName: z.string().nullable() }),
  startAt: z.string(),
  endAt: z.string(),
  currency: z.enum(CURRENCY_CODES),
  subtotal: z.number().int(),
  renterFee: z.number().int(),
  total: z.number().int(),
  platformFee: z.number().int(),
  hostPayout: z.number().int(),
  renterTier: z.enum(LOYALTY_TIERS).nullable(),
  cancellationPolicy: z.enum(CANCELLATION_POLICIES),
  freeCancellationUntil: z.string(),
  holdExpiresAt: z.string().nullable(),
  approvalDeadline: z.string().nullable(),
  refundedAmount: z.number().int(),
  canExtend: z.boolean(),
  canCancel: z.boolean(),
  createdAt: z.string(),
});
export type Booking = z.infer<typeof bookingSchema>;

export const bookingListSchema = z.object({ items: z.array(bookingSchema) });

export const createBookingResponseSchema = z.object({ booking: bookingSchema, payment: paymentSessionSchema });
export type CreateBookingResponse = z.infer<typeof createBookingResponseSchema>;

export const extendBookingSchema = z.object({ minutes: z.number().int().min(15).max(7 * 24 * 60) });
/** payment = null, wenn die Verlängerung nichts kostet (z. B. Tagespreis deckt sie schon ab). */
export const extendResponseSchema = z.object({ quote: quoteSchema, payment: paymentSessionSchema.nullable(), booking: bookingSchema });
export type ExtendResponse = z.infer<typeof extendResponseSchema>;

export const twintPayRequestSchema = z.object({ returnUrl: z.string().min(8).max(500) });
export const twintPayResponseSchema = z.object({ redirectUrl: z.string().nullable() });

export const cancelBookingSchema = z.object({ reason: z.string().trim().max(300).optional() });
export const cancelPreviewSchema = z.object({ refund: z.number().int(), free: z.boolean(), deadline: z.string() });

/* ─────────────── Treueprogramm ─────────────── */

export const loyaltyTierInfoSchema = z.object({
  tier: z.enum(LOYALTY_TIERS),
  minPoints: z.number().int(),
  renterFeeBps: z.number().int(),
  hostFeeBps: z.number().int(),
  earlyAccessHours: z.number().int(),
});
export type LoyaltyTierInfo = z.infer<typeof loyaltyTierInfoSchema>;

export const loyaltySchema = z.object({
  tier: z.enum(LOYALTY_TIERS),
  points: z.number().int(),
  /** Bis wann die aktuelle Stufe mindestens gilt. */
  heldUntil: z.string().nullable(),
  next: loyaltyTierInfoSchema.nullable(),
  pointsToNext: z.number().int(),
  tiers: z.array(loyaltyTierInfoSchema),
});
export type Loyalty = z.infer<typeof loyaltySchema>;

export const createEventSchema = z.object({
  name: z.string().trim().min(3).max(120),
  lat: z.number().min(45.8).max(47.85),
  lng: z.number().min(5.9).max(10.55),
  radiusMeters: z.number().int().min(100).max(10_000).default(1500),
  startsAt: isoDate,
  endsAt: isoDate,
  publicOpenAt: isoDate,
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const eventSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  radiusMeters: z.number().int(),
  startsAt: z.string(),
  endsAt: z.string(),
  publicOpenAt: z.string(),
  /** Nur mit Anmeldung: ab wann diese Person buchen darf. */
  yourAccessAt: z.string().nullable(),
});
export type ParkEvent = z.infer<typeof eventSchema>;
export const eventListSchema = z.object({ items: z.array(eventSchema) });

export const payoutAccountSchema = z.object({
  provider: z.enum(PAYMENT_PROVIDERS),
  connected: z.boolean(),
  detailsSubmitted: z.boolean(),
  payoutsEnabled: z.boolean(),
  /** Noch nicht ausbezahlt (Rappen). */
  pendingAmount: z.number().int(),
  /** Bereits an Stripe überwiesen (Rappen). */
  transferredAmount: z.number().int(),
  currency: z.enum(CURRENCY_CODES),
});
export type PayoutAccount = z.infer<typeof payoutAccountSchema>;
export const onboardingLinkSchema = z.object({ url: z.string() });

export const paymentConfigSchema = z.object({
  provider: z.enum(PAYMENT_PROVIDERS),
  publishableKey: z.string().nullable(),
  merchantCountry: z.string(),
  merchantName: z.string(),
});
export type PaymentConfig = z.infer<typeof paymentConfigSchema>;
