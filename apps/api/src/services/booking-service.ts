import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  bookingAmounts,
  BOOKING_STEP_MINUTES,
  calculateQuote,
  cancellationRefund,
  durationMinutes,
  ERROR_CODES,
  isWithinAvailability,
  PricingError,
  type Booking,
  type BookingQuote,
  type CancellationPolicy,
  type CreateBookingResponse,
  type ExtendResponse,
  type LoyaltyTierInfo,
  type PaymentSession,
  type PayoutAccount,
  type QuoteLine,
} from '@parking/shared';
import type { Database } from '../db/client';
import { availabilityRules, bookings, hostProfiles, parkingSpots, paymentEvents, payments, refunds, regions, users } from '../db/schema';
import { AppError, PG_ERRORS, pgErrorCode } from '../lib/errors';
import { DevPayments, PaymentError, type PaymentProvider } from '../adapters/payments';
import type { LoyaltyService } from './loyalty-service';
import type { SpotService } from './spot-service';

type BookingRow = typeof bookings.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;
type SpotRow = typeof parkingSpots.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export const HOLD_MINUTES = 15;
export const APPROVAL_HOURS = 24;
export const MAX_EXTENSIONS = 10;
const BOOKING_HORIZON_DAYS = 365;

interface Breakdown {
  lines: QuoteLine[];
  cancellationPolicy: CancellationPolicy;
  instantBook: boolean;
}

interface ExtensionMeta {
  fromEndAt: string;
  newEndAt: string;
  subtotal: number;
  renterFee: number;
  platformFee: number;
  hostPayout: number;
}

interface Log {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

const MIN = 60_000;

function paymentFailed(err: unknown): never {
  if (err instanceof PaymentError) {
    throw new AppError(err.status >= 500 || err.status === 429 ? 503 : 502, ERROR_CODES.SERVICE_UNAVAILABLE, `Zahlung nicht möglich: ${err.message}`);
  }
  throw err;
}

/**
 * Buchen, bezahlen, stornieren, verlängern und auszahlen.
 *
 * Ablauf: Angebot (quote) → Buchung PENDING_PAYMENT hält den Zeitraum 15 Minuten →
 * Zahlung erfolgreich → CONFIRMED (Sofortbuchung) oder PENDING_APPROVAL (auf Anfrage, Vermieter
 * hat bis 24 h Zeit) → nach Ende COMPLETED → Auszahlung an den Vermieter nach PAYOUT_DELAY_HOURS.
 * Doppelbuchungen verhindert der Exclusion Constraint in der Datenbank.
 */
export class BookingService {
  constructor(
    private readonly db: Database,
    private readonly payments: PaymentProvider,
    private readonly loyalty: LoyaltyService,
    private readonly spots: SpotService,
    private readonly opts: { publicApiUrl: string; payoutDelayHours: number; allowDevPay: boolean },
    private readonly log: Log,
  ) {}

  get provider() {
    return this.payments;
  }

  // ─── Angebot ─────────────────────────────────────────────────────────

  private async loadSpot(spotId: string) {
    const [row] = await this.db
      .select({ spot: parkingSpots, timezone: regions.timezone })
      .from(parkingSpots)
      .innerJoin(regions, eq(regions.id, parkingSpots.regionId))
      .where(eq(parkingSpots.id, spotId));
    if (!row) throw AppError.notFound('Parkplatz nicht gefunden');
    return row;
  }

  /** Prüft Zeitraum und Regeln des Parkplatzes (ohne Überschneidungen mit anderen Buchungen). */
  private async checkSlot(spot: SpotRow, timezone: string, start: Date, end: Date, now: Date, opts: { skipLeadTime?: boolean } = {}) {
    const step = BOOKING_STEP_MINUTES * MIN;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw AppError.validation('Ungültige Zeit');
    if (start.getTime() % step || end.getTime() % step) throw AppError.validation(`Bitte in ${BOOKING_STEP_MINUTES}-Minuten-Schritten buchen`);
    if (end <= start) throw AppError.validation('Das Ende muss nach dem Beginn liegen');
    if (!opts.skipLeadTime) {
      // Die laufende Viertelstunde darf noch gebucht werden
      if (start.getTime() + step <= now.getTime() + spot.leadTimeMinutes * MIN) {
        throw AppError.validation(
          spot.leadTimeMinutes > 0 ? `Bitte mindestens ${spot.leadTimeMinutes >= 60 ? `${Math.round(spot.leadTimeMinutes / 60)} Std.` : `${spot.leadTimeMinutes} Min.`} im Voraus buchen` : 'Der Beginn liegt in der Vergangenheit',
        );
      }
      if (start.getTime() > now.getTime() + BOOKING_HORIZON_DAYS * 24 * 60 * MIN) throw AppError.validation('Höchstens 1 Jahr im Voraus buchbar');
    }
    const rules = await this.db
      .select({ weekday: availabilityRules.weekday, startMinute: availabilityRules.startMinute, endMinute: availabilityRules.endMinute })
      .from(availabilityRules)
      .where(eq(availabilityRules.spotId, spot.id));
    if (!isWithinAvailability(rules, spot.access24h, start, end, timezone)) {
      throw AppError.conflict('Der Parkplatz ist in diesem Zeitraum nicht verfügbar');
    }
    const blocked = await this.db.execute(sql`
      select 1 from availability_exceptions
      where spot_id = ${spot.id} and is_blocked and tstzrange(start_at, end_at) && tstzrange(${start}, ${end}) limit 1`);
    if (blocked.rows.length) throw AppError.conflict('Der Vermieter hat diesen Zeitraum gesperrt');
  }

  private async isTaken(spotId: string, start: Date, end: Date, now: Date, exceptBookingId: string | null = null) {
    const res = await this.db.execute(sql`
      select 1 from bookings
      where spot_id = ${spotId}
        and (status in ('PENDING_APPROVAL', 'CONFIRMED') or (status = 'PENDING_PAYMENT' and hold_expires_at > ${now}))
        and tstzrange(start_at, end_at, '[)') && tstzrange(${start}, ${end}, '[)')
        ${exceptBookingId ? sql`and id <> ${exceptBookingId}` : sql``}
      limit 1`);
    return res.rows.length > 0;
  }

  async quote(userId: string | null, spotId: string, startAt: string, endAt: string, now = new Date()): Promise<BookingQuote> {
    const { spot, timezone } = await this.loadSpot(spotId);
    if (spot.status !== 'ACTIVE') throw AppError.notFound('Parkplatz nicht gefunden');
    if (userId && spot.hostId === userId) throw AppError.conflict('Das ist dein eigener Parkplatz');
    const start = new Date(startAt);
    const end = new Date(endAt);
    await this.checkSlot(spot, timezone, start, end, now);
    const minutes = durationMinutes(start, end);
    if (minutes < spot.minDurationMinutes) throw AppError.validation(`Mindestdauer: ${spot.minDurationMinutes >= 60 ? `${spot.minDurationMinutes / 60} Std.` : `${spot.minDurationMinutes} Min.`}`);
    if (minutes > spot.maxDurationMinutes) throw AppError.validation(`Höchstdauer: ${Math.round(spot.maxDurationMinutes / 60)} Std.`);
    if (await this.isTaken(spot.id, start, end, now)) throw AppError.conflict('In diesem Zeitraum ist der Parkplatz schon gebucht');

    let price;
    try {
      price = calculateQuote({ hourly: spot.priceHourly, daily: spot.priceDaily, weekly: spot.priceWeekly, monthly: spot.priceMonthly }, minutes);
    } catch (err) {
      if (err instanceof PricingError) throw AppError.validation(err.message);
      throw err;
    }
    const [renterTier, hostTier, bronze] = await Promise.all([this.loyalty.current(userId, now), this.loyalty.current(spot.hostId, now), this.loyalty.info('BRONZE')]);
    const amounts = bookingAmounts(price.subtotal, renterTier.renterFeeBps, hostTier.hostFeeBps);
    const bronzeFee = bookingAmounts(price.subtotal, bronze.renterFeeBps, hostTier.hostFeeBps).renterFee;

    const ev = await this.loyalty.eventFor({ lat: spot.location.y, lng: spot.location.x }, start, end);
    const yourAccessAt = ev ? this.loyalty.accessAt(ev.publicOpenAt, renterTier) : null;

    return {
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      durationMinutes: minutes,
      lines: price.lines,
      subtotal: amounts.subtotal,
      renterFee: amounts.renterFee,
      renterFeeBps: renterTier.renterFeeBps,
      total: amounts.total,
      currency: spot.currency.trim() as BookingQuote['currency'],
      tier: renterTier.tier,
      tierSavings: Math.max(0, bronzeFee - amounts.renterFee),
      instantBook: spot.instantBook,
      cancellationPolicy: spot.cancellationPolicy,
      freeCancellationUntil: cancellationRefund({ total: amounts.total, startAt: start, policy: spot.cancellationPolicy, status: 'CONFIRMED' }, 'RENTER', now).deadline.toISOString(),
      event: ev
        ? { id: ev.id, name: ev.name, publicOpenAt: ev.publicOpenAt.toISOString(), yourAccessAt: yourAccessAt!.toISOString(), canBookNow: now >= yourAccessAt! }
        : null,
    };
  }

  // ─── Buchen und bezahlen ─────────────────────────────────────────────

  private async session(p: { id: string; amount: number; currency: string; clientSecret: string | null; customerId: string | null }): Promise<PaymentSession> {
    let ephemeralKey: string | null = null;
    if (p.customerId) ephemeralKey = await this.payments.ephemeralKey(p.customerId).catch(paymentFailed);
    return {
      provider: this.payments.name,
      paymentId: p.id,
      amount: p.amount,
      currency: p.currency.trim() as PaymentSession['currency'],
      clientSecret: p.clientSecret,
      customerId: p.customerId,
      ephemeralKey,
      publishableKey: this.payments.publishableKey,
    };
  }

  private async customerFor(userId: string): Promise<string | null> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw AppError.unauthenticated();
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || null;
    const id = await this.payments.ensureCustomer({ id: u.id, email: u.email, name }, u.stripeCustomerId).catch(paymentFailed);
    if (id && id !== u.stripeCustomerId) await this.db.update(users).set({ stripeCustomerId: id }).where(eq(users.id, u.id));
    return id;
  }

  private async openPayment(booking: BookingRow, amount: number, purpose: 'BOOKING' | 'EXTENSION', metadata: ExtensionMeta | null, description: string) {
    const paymentId = randomUUID();
    const customerId = await this.customerFor(booking.renterId);
    const intent = await this.payments
      .createIntent({
        amount,
        currency: booking.currency.trim(),
        customerId,
        transferGroup: `booking_${booking.id}`,
        description,
        metadata: { paymentId, bookingId: booking.id, purpose },
      })
      .catch(paymentFailed);
    await this.db.insert(payments).values({
      id: paymentId,
      bookingId: booking.id,
      provider: this.payments.name,
      providerPaymentId: intent.id,
      amount,
      currency: booking.currency,
      purpose,
      metadata,
    });
    return this.session({ id: paymentId, amount, currency: booking.currency, clientSecret: intent.clientSecret, customerId });
  }

  async create(userId: string, input: { spotId: string; startAt: string; endAt: string }, now = new Date()): Promise<CreateBookingResponse> {
    await this.expireHolds(now, input.spotId);
    const q = await this.quote(userId, input.spotId, input.startAt, input.endAt, now);
    if (q.event && !q.event.canBookNow) {
      throw new AppError(403, ERROR_CODES.FORBIDDEN, `Für "${q.event.name}" kannst du ab ${new Date(q.event.yourAccessAt).toLocaleString('de-CH', { timeZone: 'Europe/Zurich', dateStyle: 'short', timeStyle: 'short' })} buchen. Mit höherem Status früher.`, {
        yourAccessAt: q.event.yourAccessAt,
      });
    }
    const { spot } = await this.loadSpot(input.spotId);
    const hostTier = await this.loyalty.current(spot.hostId, now);
    const amounts = bookingAmounts(q.subtotal, q.renterFeeBps, hostTier.hostFeeBps);
    const breakdown: Breakdown = { lines: q.lines, cancellationPolicy: q.cancellationPolicy, instantBook: q.instantBook };

    let booking: BookingRow;
    try {
      [booking] = (await this.db
        .insert(bookings)
        .values({
          spotId: spot.id,
          renterId: userId,
          hostId: spot.hostId,
          startAt: new Date(q.startAt),
          endAt: new Date(q.endAt),
          status: 'PENDING_PAYMENT',
          currency: spot.currency,
          subtotal: amounts.subtotal,
          renterFee: amounts.renterFee,
          total: amounts.total,
          platformFee: amounts.platformFee,
          hostPayout: amounts.hostPayout,
          hostFeeBps: hostTier.hostFeeBps,
          renterFeeBps: q.renterFeeBps,
          priceBreakdown: breakdown,
          holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * MIN),
          renterTier: q.tier,
          hostTier: hostTier.tier,
          eventId: q.event?.id ?? null,
        })
        .returning()) as [BookingRow];
    } catch (err) {
      if (pgErrorCode(err) === PG_ERRORS.EXCLUSION_VIOLATION) throw AppError.conflict('Gerade eben hat jemand anderes diesen Zeitraum gebucht');
      throw err;
    }

    let payment: PaymentSession;
    try {
      payment = await this.openPayment(booking, booking.total, 'BOOKING', null, `Parkly: ${spot.title}`);
    } catch (err) {
      await this.db.update(bookings).set({ status: 'EXPIRED', holdExpiresAt: null }).where(eq(bookings.id, booking.id));
      throw err;
    }
    return { booking: await this.get(userId, booking.id, now), payment };
  }

  /**
   * Zahlung als erfolgreich verbuchen (idempotent; aus Webhook, Abfrage oder Testzahlung).
   * Ist der Zeitraum inzwischen weg (Reservierung abgelaufen und neu vergeben), wird sofort erstattet.
   */
  async markPaid(paymentId: string, methodType: string | null, now = new Date()): Promise<void> {
    const toRefund = await this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
      if (!p || !['REQUIRES_PAYMENT', 'PROCESSING', 'FAILED', 'CANCELED'].includes(p.status)) return null;
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, p.bookingId)).for('update');
      if (!b) return null;
      await tx.update(payments).set({ status: 'SUCCEEDED', methodType, failureCode: null, failureMessage: null }).where(eq(payments.id, p.id));

      const tryUpdate = async (values: Partial<BookingRow>) => {
        try {
          await tx.transaction(async (sp) => {
            await sp.update(bookings).set(values).where(eq(bookings.id, b.id));
          });
          return true;
        } catch (err) {
          if (pgErrorCode(err) === PG_ERRORS.EXCLUSION_VIOLATION) return false;
          throw err;
        }
      };

      if (p.purpose === 'EXTENSION') {
        const m = p.metadata as ExtensionMeta;
        if (b.status !== 'CONFIRMED' || b.endAt.getTime() !== new Date(m.fromEndAt).getTime() || b.endAt <= now) return p;
        const ok = await tryUpdate({
          endAt: new Date(m.newEndAt),
          subtotal: b.subtotal + m.subtotal,
          renterFee: b.renterFee + m.renterFee,
          total: b.total + m.subtotal + m.renterFee,
          platformFee: b.platformFee + m.platformFee,
          hostPayout: b.hostPayout + m.hostPayout,
          extensionCount: b.extensionCount + 1,
        });
        return ok ? null : p;
      }

      if (b.status === 'PENDING_PAYMENT' || b.status === 'EXPIRED') {
        if (b.status === 'EXPIRED' && b.endAt <= now) return p;
        const instant = (b.priceBreakdown as Breakdown).instantBook !== false;
        const ok = await tryUpdate(
          instant
            ? { status: 'CONFIRMED', confirmedAt: now, holdExpiresAt: null, payoutState: 'PENDING' }
            : { status: 'PENDING_APPROVAL', holdExpiresAt: null, payoutState: 'PENDING', approvalDeadline: new Date(Math.min(now.getTime() + APPROVAL_HOURS * 3_600_000, b.startAt.getTime())) },
        );
        return ok ? null : p;
      }
      return b.status === 'CANCELLED' ? p : null;
    });
    if (toRefund) {
      this.log.warn({ bookingId: toRefund.bookingId, paymentId: toRefund.id }, 'Zahlung ohne freien Zeitraum: wird erstattet');
      await this.db.transaction(async (tx) => {
        const [p] = await tx.select().from(payments).where(eq(payments.id, toRefund.id)).for('update');
        if (p) await this.refundPayment(tx, p, p.amount - p.refundedAmount, 'Zeitraum nicht mehr verfügbar');
      });
    }
  }

  /** Status der offenen Zahlungen beim Anbieter abfragen (ohne Webhook, z. B. lokal). */
  async sync(userId: string, bookingId: string, now = new Date()): Promise<Booking> {
    const b = await this.ownBooking(userId, bookingId, 'RENTER');
    await this.syncPayments(b.id, now);
    return this.get(userId, bookingId, now);
  }

  private async syncPayments(bookingId: string, now: Date) {
    const open = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.bookingId, bookingId), inArray(payments.status, ['REQUIRES_PAYMENT', 'PROCESSING'])));
    for (const p of open) {
      const intent = await this.payments.retrieveIntent(p.providerPaymentId).catch(paymentFailed);
      if (intent.status === 'succeeded') await this.markPaid(p.id, intent.methodType, now);
      else if (intent.status === 'processing' && p.status !== 'PROCESSING') await this.db.update(payments).set({ status: 'PROCESSING' }).where(eq(payments.id, p.id));
      else if (intent.status === 'canceled') await this.db.update(payments).set({ status: 'CANCELED' }).where(eq(payments.id, p.id));
    }
  }

  /** Rücksprung nach TWINT: nur in die App (parkly://, Expo Go exp://) oder https. */
  static isAllowedReturnUrl(url: string) {
    return /^(parkly|exps?):\/\/[^\s]+$/.test(url) || /^https:\/\/[^\s]+$/.test(url);
  }

  /** Mit TWINT bezahlen: offene Zahlung direkt bestätigen und Link zur TWINT-App zurückgeben. */
  async payTwint(userId: string, bookingId: string, returnUrl: string): Promise<{ redirectUrl: string | null }> {
    if (!BookingService.isAllowedReturnUrl(returnUrl)) throw AppError.validation('Ungültige Rücksprung-Adresse');
    if (this.payments instanceof DevPayments && !this.opts.allowDevPay) throw AppError.forbidden();
    const b = await this.ownBooking(userId, bookingId, 'RENTER');
    const [open] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.bookingId, b.id), eq(payments.status, 'REQUIRES_PAYMENT')))
      .orderBy(desc(payments.createdAt))
      .limit(1);
    if (!open) throw AppError.conflict('Keine offene Zahlung');
    if (open.currency.trim() !== 'CHF') throw AppError.validation('TWINT geht nur in CHF');
    const r = await this.payments.confirmTwint(open.providerPaymentId, returnUrl).catch(paymentFailed);
    if (r.status === 'succeeded') await this.markPaid(open.id, 'twint');
    return { redirectUrl: r.redirectUrl };
  }

  /** Testzahlung (nur PAYMENT_PROVIDER=dev, nie in Produktion). */
  async devPay(userId: string, bookingId: string, now = new Date()): Promise<Booking> {
    if (!(this.payments instanceof DevPayments) || !this.opts.allowDevPay) throw AppError.forbidden('Testzahlung ist ausgeschaltet');
    const b = await this.ownBooking(userId, bookingId, 'RENTER');
    const open = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.bookingId, b.id), eq(payments.status, 'REQUIRES_PAYMENT')))
      .orderBy(desc(payments.createdAt))
      .limit(1);
    if (!open[0]) throw AppError.conflict('Keine offene Zahlung');
    this.payments.succeed(open[0].providerPaymentId);
    await this.syncPayments(b.id, now);
    return this.get(userId, bookingId, now);
  }

  // ─── Storno ──────────────────────────────────────────────────────────

  private async refundPayment(tx: Tx, p: PaymentRow, amount: number, reason: string) {
    if (amount <= 0) return;
    const r = await this.payments.refund(p.providerPaymentId, amount, `refund-${p.id}-${p.refundedAmount}-${amount}`).catch(paymentFailed);
    const refunded = p.refundedAmount + amount;
    await tx.insert(refunds).values({ paymentId: p.id, providerRefundId: r.id, amount, reason, status: r.status === 'succeeded' ? 'SUCCEEDED' : 'PENDING' });
    await tx.update(payments).set({ refundedAmount: refunded, status: refunded >= p.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED' }).where(eq(payments.id, p.id));
  }

  cancelPreview(b: BookingRow, by: 'RENTER' | 'HOST' | 'SYSTEM', now = new Date()) {
    const policy = (b.priceBreakdown as Breakdown).cancellationPolicy ?? 'MODERATE';
    return cancellationRefund({ total: b.total, startAt: b.startAt, policy, status: b.status }, by, now);
  }

  async preview(userId: string, bookingId: string, now = new Date()) {
    const b = await this.ownBooking(userId, bookingId, 'RENTER');
    const r = this.cancelPreview(b, 'RENTER', now);
    return { refund: b.status === 'PENDING_PAYMENT' ? 0 : r.refund, free: r.free, deadline: r.deadline.toISOString() };
  }

  private async cancelInternal(bookingId: string, by: 'RENTER' | 'HOST' | 'SYSTEM', actorId: string | null, reason: string | null, now: Date) {
    const cancelIntents: string[] = [];
    await this.db.transaction(async (tx) => {
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for('update');
      if (!b) throw AppError.notFound('Buchung nicht gefunden');
      if (!['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED'].includes(b.status)) throw AppError.conflict('Diese Buchung kann nicht mehr storniert werden');
      if (by !== 'SYSTEM' && b.startAt <= now) throw AppError.conflict('Die Parkzeit hat schon begonnen. Bitte melde dich beim Support.');

      const paid = await tx.select().from(payments).where(eq(payments.bookingId, b.id)).orderBy(desc(payments.createdAt)).for('update');
      for (const p of paid) if (p.status === 'REQUIRES_PAYMENT' || p.status === 'PROCESSING') cancelIntents.push(p.providerPaymentId);

      let refund = b.status === 'PENDING_PAYMENT' ? 0 : this.cancelPreview(b, by, now).refund;
      for (const p of paid) {
        if (refund <= 0) break;
        if (p.status !== 'SUCCEEDED' && p.status !== 'PARTIALLY_REFUNDED') continue;
        const amount = Math.min(refund, p.amount - p.refundedAmount);
        await this.refundPayment(tx, p, amount, reason ?? `Storno (${by})`);
        refund -= amount;
      }
      const fullyRefunded = b.status === 'PENDING_PAYMENT' || this.cancelPreview(b, by, now).refund >= b.total;
      await tx
        .update(bookings)
        .set({
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledBy: actorId,
          cancellationReason: reason ?? (by === 'SYSTEM' ? 'Automatisch storniert' : null),
          holdExpiresAt: null,
          // Späte Stornos ohne Erstattung: der Vermieter erhält seinen Anteil trotzdem
          payoutState: fullyRefunded ? 'NONE' : b.payoutState,
        })
        .where(eq(bookings.id, b.id));
      await tx.update(payments).set({ status: 'CANCELED' }).where(and(eq(payments.bookingId, b.id), inArray(payments.status, ['REQUIRES_PAYMENT', 'PROCESSING'])));
    });
    for (const id of cancelIntents) await this.payments.cancelIntent(id).catch(() => undefined);
  }

  async cancel(userId: string, bookingId: string, reason: string | null, now = new Date()): Promise<Booking> {
    await this.ownBooking(userId, bookingId, 'RENTER');
    await this.cancelInternal(bookingId, 'RENTER', userId, reason, now);
    return this.get(userId, bookingId, now);
  }

  async hostCancel(userId: string, bookingId: string, reason: string | null, now = new Date()): Promise<Booking> {
    await this.ownBooking(userId, bookingId, 'HOST');
    await this.cancelInternal(bookingId, 'HOST', userId, reason, now);
    return this.get(userId, bookingId, now);
  }

  // ─── Anfragen (Vermieter) ─────────────────────────────────────────────

  async accept(userId: string, bookingId: string, now = new Date()): Promise<Booking> {
    const b = await this.ownBooking(userId, bookingId, 'HOST');
    if (b.status !== 'PENDING_APPROVAL') throw AppError.conflict('Diese Anfrage ist nicht mehr offen');
    if (b.approvalDeadline && b.approvalDeadline <= now) throw AppError.conflict('Die Frist ist abgelaufen');
    await this.db
      .update(bookings)
      .set({ status: 'CONFIRMED', confirmedAt: now, approvalDeadline: null })
      .where(and(eq(bookings.id, b.id), eq(bookings.status, 'PENDING_APPROVAL')));
    return this.get(userId, bookingId, now);
  }

  async decline(userId: string, bookingId: string, reason: string | null, now = new Date()): Promise<Booking> {
    const b = await this.ownBooking(userId, bookingId, 'HOST');
    if (b.status !== 'PENDING_APPROVAL') throw AppError.conflict('Diese Anfrage ist nicht mehr offen');
    await this.cancelInternal(bookingId, 'HOST', userId, reason ?? 'Vom Vermieter abgelehnt', now);
    return this.get(userId, bookingId, now);
  }

  // ─── Verlängern ──────────────────────────────────────────────────────

  async extend(userId: string, bookingId: string, minutes: number, now = new Date()): Promise<ExtendResponse> {
    const b = await this.ownBooking(userId, bookingId, 'RENTER');
    if (b.status !== 'CONFIRMED' || b.endAt <= now) throw AppError.conflict('Nur laufende oder bevorstehende Buchungen können verlängert werden');
    if (b.extensionCount >= MAX_EXTENSIONS) throw AppError.conflict('Diese Buchung wurde schon zu oft verlängert');
    if (minutes % BOOKING_STEP_MINUTES) throw AppError.validation(`Bitte in ${BOOKING_STEP_MINUTES}-Minuten-Schritten verlängern`);
    const { spot, timezone } = await this.loadSpot(b.spotId);
    const newEnd = new Date(b.endAt.getTime() + minutes * MIN);
    const total = durationMinutes(b.startAt, newEnd);
    if (total > spot.maxDurationMinutes) throw AppError.validation(`Höchstdauer: ${Math.round(spot.maxDurationMinutes / 60)} Std.`);
    await this.checkSlot(spot, timezone, b.endAt, newEnd, now, { skipLeadTime: true });
    if (await this.isTaken(spot.id, b.endAt, newEnd, now, b.id)) throw AppError.conflict('Danach ist der Parkplatz schon gebucht');

    const pricing = { hourly: spot.priceHourly, daily: spot.priceDaily, weekly: spot.priceWeekly, monthly: spot.priceMonthly };
    let delta: number;
    try {
      delta = Math.max(0, calculateQuote(pricing, total).subtotal - calculateQuote(pricing, durationMinutes(b.startAt, b.endAt)).subtotal);
    } catch (err) {
      if (err instanceof PricingError) throw AppError.validation(err.message);
      throw err;
    }
    const a = bookingAmounts(delta, b.renterFeeBps, b.hostFeeBps);
    const tier = await this.loyalty.info(b.renterTier ?? 'BRONZE');
    const policy = (b.priceBreakdown as Breakdown).cancellationPolicy ?? 'MODERATE';
    const quote: BookingQuote = {
      startAt: b.endAt.toISOString(),
      endAt: newEnd.toISOString(),
      durationMinutes: minutes,
      lines: [],
      subtotal: a.subtotal,
      renterFee: a.renterFee,
      renterFeeBps: b.renterFeeBps,
      total: a.total,
      currency: b.currency.trim() as BookingQuote['currency'],
      tier: tier.tier,
      tierSavings: 0,
      instantBook: true,
      cancellationPolicy: policy,
      freeCancellationUntil: this.cancelPreview(b, 'RENTER', now).deadline.toISOString(),
      event: null,
    };
    const meta: ExtensionMeta = { fromEndAt: b.endAt.toISOString(), newEndAt: newEnd.toISOString(), subtotal: a.subtotal, renterFee: a.renterFee, platformFee: a.platformFee, hostPayout: a.hostPayout };

    if (a.total === 0) {
      // Kostet nichts (Tagespreis deckt es ab): direkt verlängern
      try {
        await this.db
          .update(bookings)
          .set({ endAt: newEnd, extensionCount: b.extensionCount + 1 })
          .where(and(eq(bookings.id, b.id), eq(bookings.endAt, b.endAt)));
      } catch (err) {
        if (pgErrorCode(err) === PG_ERRORS.EXCLUSION_VIOLATION) throw AppError.conflict('Danach ist der Parkplatz schon gebucht');
        throw err;
      }
      return { quote, payment: null, booking: await this.get(userId, b.id, now) };
    }
    const payment = await this.openPayment(b, a.total, 'EXTENSION', meta, `Parkly: Verlängerung ${spot.title}`);
    return { quote, payment, booking: await this.get(userId, b.id, now) };
  }

  // ─── Lesen ───────────────────────────────────────────────────────────

  private async ownBooking(userId: string, bookingId: string, role: 'RENTER' | 'HOST'): Promise<BookingRow> {
    const [b] = await this.db.select().from(bookings).where(eq(bookings.id, bookingId));
    if (!b || (role === 'RENTER' ? b.renterId : b.hostId) !== userId) throw AppError.notFound('Buchung nicht gefunden');
    return b;
  }

  private async rows(where: ReturnType<typeof sql>) {
    const res = await this.db.execute<Record<string, unknown>>(sql`
      select b.id, b.status, b.spot_id, b.renter_id, b.host_id, b.start_at, b.end_at, b.currency, b.subtotal, b.renter_fee, b.total,
             b.platform_fee, b.host_payout, b.renter_tier, b.price_breakdown, b.hold_expires_at, b.approval_deadline,
             b.extension_count, b.created_at,
             s.title, s.floor, s.spot_number, s.access_instructions, s.access_method,
             ST_Y(s.location) as lat, ST_X(s.location) as lng, ST_Y(s.approx_location) as alat, ST_X(s.approx_location) as alng,
             a.street, a.house_number, a.postal_code, a.city,
             ru.first_name as renter_first, hu.first_name as host_first,
             coalesce((select sum(p.refunded_amount) from payments p where p.booking_id = b.id), 0)::int as refunded
      from bookings b
      join parking_spots s on s.id = b.spot_id
      join addresses a on a.id = s.address_id
      join users ru on ru.id = b.renter_id
      join users hu on hu.id = b.host_id
      where ${where}
      order by b.start_at desc
      limit 200`);
    return res.rows;
  }

  private async toDtos(userId: string, rows: Record<string, unknown>[], now: Date): Promise<Booking[]> {
    const covers = await this.spots.covers(rows.map((r) => String(r.spot_id)));
    return rows.map((r) => {
      const role: Booking['role'] = r.host_id === userId ? 'HOST' : 'RENTER';
      const status = r.status as Booking['status'];
      const start = new Date(r.start_at as string);
      const end = new Date(r.end_at as string);
      const reveal = role === 'HOST' || status === 'CONFIRMED' || status === 'COMPLETED';
      const breakdown = r.price_breakdown as Breakdown;
      const policy = breakdown.cancellationPolicy ?? 'MODERATE';
      const deadline = cancellationRefund({ total: Number(r.total), startAt: start, policy, status }, 'RENTER', now).deadline;
      const open = ['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED'].includes(status);
      return {
        id: String(r.id),
        status,
        role,
        spot: {
          id: String(r.spot_id),
          title: String(r.title),
          coverUrl: covers.get(String(r.spot_id)) ?? null,
          area: `${String(r.postal_code)} ${String(r.city)}`,
          address: reveal ? `${String(r.street)}${r.house_number ? ` ${String(r.house_number)}` : ''}, ${String(r.postal_code)} ${String(r.city)}` : null,
          lat: Number(reveal ? r.lat : r.alat),
          lng: Number(reveal ? r.lng : r.alng),
          floor: (r.floor as string | null) ?? null,
          spotNumber: reveal ? ((r.spot_number as string | null) ?? null) : null,
          accessInstructions: reveal ? ((r.access_instructions as string | null) ?? null) : null,
          accessMethod: String(r.access_method),
        },
        counterpart: { firstName: ((role === 'HOST' ? r.renter_first : r.host_first) as string | null) ?? null },
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        currency: String(r.currency).trim() as Booking['currency'],
        subtotal: Number(r.subtotal),
        renterFee: Number(r.renter_fee),
        total: Number(r.total),
        platformFee: Number(r.platform_fee),
        hostPayout: Number(r.host_payout),
        renterTier: (r.renter_tier as Booking['renterTier']) ?? null,
        cancellationPolicy: policy,
        freeCancellationUntil: deadline.toISOString(),
        holdExpiresAt: r.hold_expires_at ? new Date(r.hold_expires_at as string).toISOString() : null,
        approvalDeadline: r.approval_deadline ? new Date(r.approval_deadline as string).toISOString() : null,
        refundedAmount: Number(r.refunded),
        canExtend: role === 'RENTER' && status === 'CONFIRMED' && end > now && Number(r.extension_count) < MAX_EXTENSIONS,
        canCancel: open && start > now && (role === 'RENTER' || status !== 'PENDING_PAYMENT'),
        createdAt: new Date(r.created_at as string).toISOString(),
      };
    });
  }

  async get(userId: string, bookingId: string, now = new Date()): Promise<Booking> {
    const rows = await this.rows(sql`b.id = ${bookingId} and (b.renter_id = ${userId} or b.host_id = ${userId})`);
    if (!rows.length) throw AppError.notFound('Buchung nicht gefunden');
    return (await this.toDtos(userId, rows, now))[0]!;
  }

  async list(userId: string, now = new Date()): Promise<Booking[]> {
    return this.toDtos(userId, await this.rows(sql`b.renter_id = ${userId} and b.status <> 'EXPIRED'`), now);
  }

  async hostList(userId: string, now = new Date()): Promise<Booking[]> {
    return this.toDtos(userId, await this.rows(sql`b.host_id = ${userId} and b.status not in ('EXPIRED', 'PENDING_PAYMENT')`), now);
  }

  // ─── Auszahlungen (Stripe Connect Express) ────────────────────────────

  async payoutAccount(userId: string): Promise<PayoutAccount> {
    const [hp] = await this.db.select().from(hostProfiles).where(eq(hostProfiles.userId, userId));
    if (!hp) throw AppError.forbidden();
    let { payoutsEnabled } = hp;
    let detailsSubmitted = hp.onboardingStatus === 'COMPLETE';
    if (hp.stripeAccountId && this.payments.name === 'stripe') {
      try {
        const acc = await this.payments.retrieveAccount(hp.stripeAccountId);
        payoutsEnabled = acc.payoutsEnabled;
        detailsSubmitted = acc.detailsSubmitted;
        await this.db
          .update(hostProfiles)
          .set({ payoutsEnabled, chargesEnabled: acc.chargesEnabled, onboardingStatus: payoutsEnabled ? 'COMPLETE' : acc.detailsSubmitted ? 'RESTRICTED' : 'PENDING' })
          .where(eq(hostProfiles.userId, userId));
      } catch (err) {
        this.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Stripe-Konto nicht abrufbar');
      }
    }
    const sums = await this.db.execute<{ pending: number; transferred: number }>(sql`
      select coalesce(sum(host_payout) filter (where payout_state in ('PENDING', 'NOT_CONNECTED') and status in ('CONFIRMED', 'COMPLETED', 'CANCELLED')), 0)::int as pending,
             coalesce(sum(host_payout) filter (where payout_state = 'TRANSFERRED'), 0)::int as transferred
      from bookings where host_id = ${userId}`);
    return {
      provider: this.payments.name,
      connected: !!hp.stripeAccountId,
      detailsSubmitted,
      payoutsEnabled,
      pendingAmount: Number(sums.rows[0]?.pending ?? 0),
      transferredAmount: Number(sums.rows[0]?.transferred ?? 0),
      currency: 'CHF',
    };
  }

  async onboardingLink(userId: string): Promise<string> {
    const [hp] = await this.db.select().from(hostProfiles).where(eq(hostProfiles.userId, userId));
    if (!hp) throw AppError.forbidden();
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    let accountId = hp.stripeAccountId;
    if (!accountId) {
      accountId = await this.payments.createConnectAccount(u!.email).catch(paymentFailed);
      await this.db.update(hostProfiles).set({ stripeAccountId: accountId, onboardingStatus: 'PENDING' }).where(eq(hostProfiles.userId, userId));
    }
    const base = this.opts.publicApiUrl.replace(/\/$/, '');
    return this.payments.accountLink(accountId, `${base}/v1/stripe/connect/refresh`, `${base}/v1/stripe/connect/return`).catch(paymentFailed);
  }

  async accountUpdated(accountId: string, a: { payoutsEnabled: boolean; chargesEnabled: boolean; detailsSubmitted: boolean }) {
    await this.db
      .update(hostProfiles)
      .set({ payoutsEnabled: a.payoutsEnabled, chargesEnabled: a.chargesEnabled, onboardingStatus: a.payoutsEnabled ? 'COMPLETE' : a.detailsSubmitted ? 'RESTRICTED' : 'PENDING' })
      .where(eq(hostProfiles.stripeAccountId, accountId));
  }

  async paymentFailedEvent(providerPaymentId: string, code: string | null, message: string | null) {
    await this.db
      .update(payments)
      .set({ status: 'FAILED', failureCode: code, failureMessage: message?.slice(0, 300) ?? null })
      .where(and(eq(payments.providerPaymentId, providerPaymentId), inArray(payments.status, ['REQUIRES_PAYMENT', 'PROCESSING'])));
  }

  async paymentByProviderId(providerPaymentId: string) {
    const [p] = await this.db.select().from(payments).where(eq(payments.providerPaymentId, providerPaymentId));
    return p ?? null;
  }

  /** Stripe-Webhook: jedes Event genau einmal verarbeiten. */
  async handleWebhook(event: { id: string; type: string; data: { object: Record<string, unknown> } }) {
    const obj = event.data.object;
    const inserted = await this.db
      .insert(paymentEvents)
      .values({ id: event.id, provider: 'stripe', type: event.type, objectId: typeof obj.id === 'string' ? obj.id : null })
      .onConflictDoNothing()
      .returning({ id: paymentEvents.id });
    if (!inserted.length) return;
    try {
      if (event.type === 'payment_intent.succeeded' && typeof obj.id === 'string') {
        const p = await this.paymentByProviderId(obj.id);
        const types = obj.payment_method_types as string[] | undefined;
        if (p) await this.markPaid(p.id, types?.[0] ?? null);
      } else if (event.type === 'payment_intent.payment_failed' && typeof obj.id === 'string') {
        const err = obj.last_payment_error as { code?: string; message?: string } | undefined;
        await this.paymentFailedEvent(obj.id, err?.code ?? null, err?.message ?? null);
      } else if (event.type === 'account.updated' && typeof obj.id === 'string') {
        await this.accountUpdated(obj.id, { payoutsEnabled: !!obj.payouts_enabled, chargesEnabled: !!obj.charges_enabled, detailsSubmitted: !!obj.details_submitted });
      }
      await this.db.update(paymentEvents).set({ processedAt: new Date() }).where(eq(paymentEvents.id, event.id));
    } catch (err) {
      // Stripe schickt das Event erneut
      await this.db.delete(paymentEvents).where(eq(paymentEvents.id, event.id));
      throw err;
    }
  }

  // ─── Hintergrund-Jobs ────────────────────────────────────────────────

  /** Unbezahlte Reservierungen freigeben (vorher nochmals beim Anbieter nachfragen). */
  async expireHolds(now = new Date(), spotId: string | null = null): Promise<number> {
    const due = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.status, 'PENDING_PAYMENT'), sql`${bookings.holdExpiresAt} <= ${now}`, spotId ? eq(bookings.spotId, spotId) : undefined))
      .limit(50);
    let expired = 0;
    for (const { id } of due) {
      try {
        await this.syncPayments(id, now);
      } catch (err) {
        this.log.warn({ bookingId: id, err: err instanceof Error ? err.message : String(err) }, 'Zahlungsstatus nicht abrufbar');
        if (spotId) continue; // beim Buchen nicht blockieren
      }
      const cancelIds = (
        await this.db
          .select({ id: payments.providerPaymentId })
          .from(payments)
          .where(and(eq(payments.bookingId, id), eq(payments.status, 'REQUIRES_PAYMENT')))
      ).map((p) => p.id);
      const res = await this.db
        .update(bookings)
        .set({ status: 'EXPIRED', holdExpiresAt: null, payoutState: 'NONE' })
        .where(and(eq(bookings.id, id), eq(bookings.status, 'PENDING_PAYMENT')))
        .returning({ id: bookings.id });
      if (res.length) {
        expired++;
        await this.db.update(payments).set({ status: 'CANCELED' }).where(and(eq(payments.bookingId, id), eq(payments.status, 'REQUIRES_PAYMENT')));
        for (const pid of cancelIds) await this.payments.cancelIntent(pid).catch(() => undefined);
      }
    }
    return expired;
  }

  /** Anfragen ohne Antwort: automatisch stornieren und voll erstatten. */
  async expireApprovals(now = new Date()): Promise<number> {
    const due = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.status, 'PENDING_APPROVAL'), sql`${bookings.approvalDeadline} <= ${now}`))
      .limit(50);
    for (const { id } of due) {
      try {
        await this.cancelInternal(id, 'SYSTEM', null, 'Vermieter hat nicht rechtzeitig bestätigt', now);
      } catch (err) {
        this.log.error({ bookingId: id, err: err instanceof Error ? err.message : String(err) }, 'Anfrage konnte nicht storniert werden');
      }
    }
    return due.length;
  }

  /** Beendete Buchungen abschliessen und Treuepunkte neu berechnen. */
  async completeFinished(now = new Date()): Promise<number> {
    const done = await this.db
      .update(bookings)
      .set({ status: 'COMPLETED', completedAt: now })
      .where(and(eq(bookings.status, 'CONFIRMED'), sql`${bookings.endAt} <= ${now}`))
      .returning({ renterId: bookings.renterId, hostId: bookings.hostId });
    const people = new Set(done.flatMap((d) => [d.renterId, d.hostId]));
    for (const id of people) await this.loyalty.recompute(id, now);
    return done.length;
  }

  /** Vermieteranteil überweisen (PAYOUT_DELAY_HOURS nach Ende). Ohne Auszahlungskonto: wartet. */
  async processPayouts(now = new Date()): Promise<{ transferred: number; waiting: number }> {
    const cutoff = new Date(now.getTime() - this.opts.payoutDelayHours * 3_600_000);
    const due = await this.db
      .select({ b: bookings, hp: hostProfiles })
      .from(bookings)
      .leftJoin(hostProfiles, eq(hostProfiles.userId, bookings.hostId))
      .where(
        and(
          inArray(bookings.payoutState, ['PENDING', 'NOT_CONNECTED']),
          inArray(bookings.status, ['COMPLETED', 'CANCELLED']),
          sql`${bookings.endAt} <= ${cutoff}`,
        ),
      )
      .orderBy(asc(bookings.endAt))
      .limit(50);
    let transferred = 0;
    let waiting = 0;
    for (const { b, hp } of due) {
      if (b.hostPayout <= 0) {
        await this.db.update(bookings).set({ payoutState: 'NONE' }).where(eq(bookings.id, b.id));
        continue;
      }
      const canTransfer = this.payments.name === 'dev' || (!!hp?.stripeAccountId && hp.payoutsEnabled);
      if (!canTransfer) {
        waiting++;
        if (b.payoutState !== 'NOT_CONNECTED') await this.db.update(bookings).set({ payoutState: 'NOT_CONNECTED' }).where(eq(bookings.id, b.id));
        continue;
      }
      try {
        const t = await this.payments.transfer({
          amount: b.hostPayout,
          currency: b.currency.trim(),
          destination: hp?.stripeAccountId ?? 'dev',
          transferGroup: `booking_${b.id}`,
          idempotencyKey: `payout-${b.id}`,
        });
        await this.db.update(bookings).set({ payoutState: 'TRANSFERRED', transferId: t.id }).where(eq(bookings.id, b.id));
        transferred++;
      } catch (err) {
        // z. B. Guthaben bei Stripe noch nicht verfügbar: nächster Durchlauf versucht es wieder
        this.log.warn({ bookingId: b.id, err: err instanceof Error ? err.message : String(err) }, 'Auszahlung verschoben');
      }
    }
    return { transferred, waiting };
  }

  async runJobs(now = new Date()) {
    const expired = await this.expireHolds(now);
    const approvals = await this.expireApprovals(now);
    const completed = await this.completeFinished(now);
    const payouts = await this.processPayouts(now);
    return { expired, approvals, completed, ...payouts };
  }

  tierFor(userId: string): Promise<LoyaltyTierInfo> {
    return this.loyalty.current(userId);
  }
}
