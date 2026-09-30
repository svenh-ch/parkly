import type { PaymentSession } from '@parking/shared';
import { api } from '@/lib/api';

export type PayMethod = 'twint' | 'card';
export type CollectResult = 'paid' | 'redirected' | 'canceled' | 'dev';

/** Im Web gibt es vorerst nur die Testzahlung; echte Zahlungen laufen in der App. */
export async function collectPayment(session: PaymentSession, method: PayMethod, bookingId: string): Promise<CollectResult> {
  if (session.provider === 'dev') {
    if (method === 'twint') {
      await api.bookings.twint(bookingId, 'https://parkly.ch/payment-return');
      return 'paid';
    }
    return 'dev';
  }
  throw new Error('Bezahlen mit Karte oder TWINT geht in der Parkly-App (iPhone/Android).');
}
