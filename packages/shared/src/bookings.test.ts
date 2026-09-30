import { describe, expect, it } from 'vitest';
import { bookingAmounts, cancellationRefund, isWithinAvailability, localSlot } from './schemas/bookings';

describe('Verfügbarkeit', () => {
  const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 7 * 60, endMinute: 19 * 60 }));
  it('rechnet in Schweizer Ortszeit (inkl. Sommerzeit)', () => {
    // Mi 1. Juli 2026, 08:00 Ortszeit = 06:00 UTC
    expect(localSlot(new Date('2026-07-01T06:00:00Z'), 'Europe/Zurich')).toEqual({ weekday: 3, minute: 480 });
    // Mi 7. Januar 2026, 08:00 Ortszeit = 07:00 UTC
    expect(localSlot(new Date('2026-01-07T07:00:00Z'), 'Europe/Zurich')).toEqual({ weekday: 3, minute: 480 });
  });
  it('prüft Zeiträume gegen die Regeln', () => {
    expect(isWithinAvailability(weekdays, false, new Date('2026-07-01T06:00:00Z'), new Date('2026-07-01T10:00:00Z'))).toBe(true);
    expect(isWithinAvailability(weekdays, false, new Date('2026-07-01T16:00:00Z'), new Date('2026-07-01T17:30:00Z'))).toBe(false);
    expect(isWithinAvailability(weekdays, false, new Date('2026-07-04T08:00:00Z'), new Date('2026-07-04T09:00:00Z'))).toBe(false); // Samstag
    expect(isWithinAvailability([], true, new Date('2026-07-04T08:00:00Z'), new Date('2026-07-04T09:00:00Z'))).toBe(true);
  });
});

describe('Beträge und Storno', () => {
  it('trennt Servicegebühr und Vermietergebühr', () => {
    expect(bookingAmounts(1000, 1000, 1500)).toEqual({ subtotal: 1000, renterFee: 100, total: 1100, platformFee: 150, hostPayout: 850 });
    expect(bookingAmounts(1230, 500, 1000)).toEqual({ subtotal: 1230, renterFee: 60, total: 1290, platformFee: 123, hostPayout: 1107 });
  });
  it('erstattet vor der Frist alles, danach nichts; Vermieter-Storno immer alles', () => {
    const b = { total: 1100, startAt: new Date('2026-07-02T10:00:00Z'), policy: 'MODERATE' as const, status: 'CONFIRMED' };
    expect(cancellationRefund(b, 'RENTER', new Date('2026-07-01T09:00:00Z'))).toMatchObject({ refund: 1100, free: true });
    expect(cancellationRefund(b, 'RENTER', new Date('2026-07-01T11:00:00Z'))).toMatchObject({ refund: 0, free: false });
    expect(cancellationRefund(b, 'HOST', new Date('2026-07-02T09:00:00Z'))).toMatchObject({ refund: 1100 });
  });
});
