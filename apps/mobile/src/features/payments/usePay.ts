import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Booking, PaymentSession } from '@parking/shared';
import { api } from '@/lib/api';
import { collectPayment, type PayMethod } from './checkout';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const METHOD_KEY = 'parkly.payMethod';

/** Zuletzt gewählte Zahlungsart (nur auf dem Gerät gespeichert). Standard: TWINT. */
export function usePayMethod() {
  const [method, setMethodState] = useState<PayMethod>('twint');
  useEffect(() => {
    void AsyncStorage.getItem(METHOD_KEY)
      .then((v) => (v === 'card' || v === 'twint') && setMethodState(v))
      .catch(() => undefined);
  }, []);
  const setMethod = (m: PayMethod) => {
    setMethodState(m);
    void AsyncStorage.setItem(METHOD_KEY, m).catch(() => undefined);
  };
  return [method, setMethod] as const;
}

/**
 * Bezahlen und danach den Status beim Server abholen (ohne Webhook-Abhängigkeit).
 * Ergebnis: bezahlt (Buchung), abgebrochen (null) oder Fehler (wirft).
 */
export function usePay() {
  const [paying, setPaying] = useState(false);

  const pay = async (bookingId: string, session: PaymentSession, method: PayMethod, isPaid: (b: Booking) => boolean): Promise<Booking | null> => {
    setPaying(true);
    try {
      const result = await collectPayment(session, method, bookingId);
      if (result === 'canceled') return null;
      if (result === 'dev') {
        await wait(700); // kurzer "Verarbeitung"-Moment wie bei einer echten Zahlung
        return await api.bookings.devPay(bookingId);
      }
      // Nach TWINT: kurz nachfragen; nicht bestätigt = abgebrochen
      const tries = result === 'redirected' ? 8 : 12;
      for (let i = 0; i < tries; i++) {
        const b = await api.bookings.sync(bookingId);
        if (isPaid(b)) return b;
        await wait(i < 4 ? 600 : 1500);
      }
      if (result === 'redirected') return null;
      throw new Error('Die Zahlung wird noch verarbeitet. Du findest die Buchung gleich unter "Buchungen".');
    } finally {
      setPaying(false);
    }
  };

  return { pay, paying };
}
