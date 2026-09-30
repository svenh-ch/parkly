import { sql } from 'drizzle-orm';
import { check, date, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { currencyCode, id, timestamps } from './_shared';
import { bookingStatusEnum, paymentStatusEnum, payoutStatusEnum, refundStatusEnum } from './enums';
import { parkingSpots } from './spots';
import { users } from './users';

/**
 * Buchungen. Doppelbuchungen verhindert der Exclusion Constraint
 * "bookings_no_overlap" (siehe Migration 0002_booking_constraints.sql):
 * Für denselben Parkplatz dürfen sich Zeiträume mit Status PENDING_PAYMENT/CONFIRMED
 * nicht überschneiden, auch nicht bei gleichzeitigen Anfragen.
 *
 * Alle Beträge sind ein Snapshot zum Buchungszeitpunkt (in Rappen).
 */
export const bookings = pgTable(
  'bookings',
  {
    id: id(),
    spotId: uuid('spot_id')
      .notNull()
      .references(() => parkingSpots.id),
    renterId: uuid('renter_id')
      .notNull()
      .references(() => users.id),
    /** Denormalisiert für schnelle Vermieter-Abfragen und Zugriffskontrolle. */
    hostId: uuid('host_id')
      .notNull()
      .references(() => users.id),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    status: bookingStatusEnum('status').notNull().default('PENDING_PAYMENT'),
    currency: currencyCode('currency').notNull(),
    subtotal: integer('subtotal').notNull(),
    renterFee: integer('renter_fee').notNull().default(0),
    total: integer('total').notNull(),
    platformFee: integer('platform_fee').notNull(),
    hostPayout: integer('host_payout').notNull(),
    hostFeeBps: integer('host_fee_bps').notNull(),
    renterFeeBps: integer('renter_fee_bps').notNull().default(0),
    priceBreakdown: jsonb('price_breakdown').notNull(),
    /** Bis wann eine unbezahlte Buchung den Zeitraum reserviert. */
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancellationReason: text('cancellation_reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Buchung auf Anfrage: bis wann der Vermieter annehmen muss. */
    approvalDeadline: timestamp('approval_deadline', { withTimezone: true }),
    /** Treue-Stufen zum Buchungszeitpunkt (Snapshot für Gebühren). */
    renterTier: text('renter_tier'),
    hostTier: text('host_tier'),
    eventId: uuid('event_id'),
    extensionCount: integer('extension_count').notNull().default(0),
    /** Auszahlung an den Vermieter: PENDING, TRANSFERRED, NOT_CONNECTED, NONE */
    payoutState: text('payout_state').notNull().default('PENDING'),
    transferId: text('transfer_id'),
    ...timestamps,
  },
  (t) => [
    check('bookings_time_range', sql`${t.endAt} > ${t.startAt}`),
    check(
      'bookings_amounts',
      sql`${t.subtotal} >= 0 and ${t.total} = ${t.subtotal} + ${t.renterFee} and ${t.platformFee} + ${t.hostPayout} = ${t.subtotal}`,
    ),
    index('bookings_renter_idx').on(t.renterId, t.startAt),
    index('bookings_host_idx').on(t.hostId, t.startAt),
    index('bookings_spot_idx').on(t.spotId, t.startAt),
    index('bookings_pending_hold_idx')
      .on(t.holdExpiresAt)
      .where(sql`${t.status} = 'PENDING_PAYMENT'`),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    provider: text('provider').notNull(), // "stripe" | "dev"
    providerPaymentId: text('provider_payment_id').notNull().unique(),
    amount: integer('amount').notNull(),
    currency: currencyCode('currency').notNull(),
    status: paymentStatusEnum('status').notNull().default('REQUIRES_PAYMENT'),
    methodType: text('method_type'), // card, twint, apple_pay, ...
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    /** BOOKING oder EXTENSION */
    purpose: text('purpose').notNull().default('BOOKING'),
    /** z. B. bei Verlängerung: neues Ende und Beträge */
    metadata: jsonb('metadata'),
    refundedAmount: integer('refunded_amount').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('payments_booking_idx').on(t.bookingId)],
);

export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    providerRefundId: text('provider_refund_id').unique(),
    amount: integer('amount').notNull(),
    reason: text('reason'),
    status: refundStatusEnum('status').notNull().default('PENDING'),
    ...timestamps,
  },
  (t) => [index('refunds_payment_idx').on(t.paymentId)],
);

/** Spiegel der Stripe-Auszahlungen für das spätere Finanz-Dashboard der Vermieter. */
export const payouts = pgTable(
  'payouts',
  {
    id: id(),
    hostId: uuid('host_id')
      .notNull()
      .references(() => users.id),
    providerPayoutId: text('provider_payout_id').notNull().unique(),
    amount: integer('amount').notNull(),
    currency: currencyCode('currency').notNull(),
    status: payoutStatusEnum('status').notNull(),
    arrivalDate: date('arrival_date'),
    ...timestamps,
  },
  (t) => [index('payouts_host_idx').on(t.hostId, t.createdAt)],
);

/** Idempotenz für Webhooks: jedes Provider-Event wird genau einmal verarbeitet. */
export const paymentEvents = pgTable('payment_events', {
  id: text('id').primaryKey(), // Stripe event id
  provider: text('provider').notNull(),
  type: text('type').notNull(),
  objectId: text('object_id'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});
