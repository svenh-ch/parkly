import type { BookingStatus } from './enums';

/** Anzeige-Phase einer Buchung, abgeleitet aus Status und Zeit. */
export type BookingPhase = 'PENDING' | 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export function deriveBookingPhase(
  booking: { status: BookingStatus; startAt: Date | string; endAt: Date | string },
  now: Date = new Date(),
): BookingPhase {
  const start = new Date(booking.startAt).getTime();
  const end = new Date(booking.endAt).getTime();
  switch (booking.status) {
    case 'PENDING_PAYMENT':
    case 'PENDING_APPROVAL':
      return 'PENDING';
    case 'CANCELLED':
    case 'EXPIRED':
      return 'CANCELLED';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'CONFIRMED':
      if (now.getTime() < start) return 'UPCOMING';
      if (now.getTime() < end) return 'ACTIVE';
      return 'COMPLETED';
  }
}

/** Minuten, die eine unbezahlte Buchung den Zeitraum reserviert. */
export const PAYMENT_HOLD_MINUTES = 15;

/** Maximale Buchungsdauer im MVP (Vorauszahlung). */
export const MAX_BOOKING_DAYS = 90;
