import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { initPaymentSheet, initStripe, presentPaymentSheet, PaymentSheetError } from '@stripe/stripe-react-native';
import type { PaymentSession } from '@parking/shared';
import { api } from '@/lib/api';
import { colors } from '@/ui';

export type PayMethod = 'twint' | 'card';
/** paid = bezahlt, redirected = zurück aus TWINT (Status wird abgefragt), canceled, dev = Testzahlung */
export type CollectResult = 'paid' | 'redirected' | 'canceled' | 'dev';

let initializedKey: string | null = null;
const isExpoGo = Constants.executionEnvironment === 'storeClient';

/** TWINT: direkt zur TWINT-App, ohne Stripe-Zahlungsblatt. */
async function payWithTwint(bookingId: string): Promise<CollectResult> {
  const returnUrl = Linking.createURL('payment-return');
  const { redirectUrl } = await api.bookings.twint(bookingId, returnUrl);
  if (!redirectUrl) return 'paid'; // Testmodus: sofort bezahlt
  // Ob bezahlt wurde, entscheidet danach der Server (nicht der Browser)
  await WebBrowser.openAuthSessionAsync(redirectUrl, returnUrl);
  return 'redirected';
}

/** Karte / Apple Pay / Google Pay über das Stripe-Zahlungsblatt. */
async function payWithSheet(session: PaymentSession): Promise<CollectResult> {
  if (!session.publishableKey || !session.clientSecret) throw new Error('Zahlung ist nicht eingerichtet.');
  if (initializedKey !== session.publishableKey) {
    await initStripe({
      publishableKey: session.publishableKey,
      merchantIdentifier: 'merchant.ch.parkly.app',
      urlScheme: isExpoGo ? Linking.createURL('/--/') : Linking.createURL(''),
    });
    initializedKey = session.publishableKey;
  }

  const init = await initPaymentSheet({
    merchantDisplayName: 'Parkly',
    paymentIntentClientSecret: session.clientSecret,
    customerId: session.customerId ?? undefined,
    customerEphemeralKeySecret: session.ephemeralKey ?? undefined,
    returnURL: Linking.createURL('stripe-redirect'),
    allowsDelayedPaymentMethods: false,
    applePay: isExpoGo ? undefined : { merchantCountryCode: 'CH' },
    googlePay: isExpoGo ? undefined : { merchantCountryCode: 'CH', testEnv: session.publishableKey.startsWith('pk_test_'), currencyCode: session.currency },
    // Immer hell (auch im Dunkelmodus), damit alles gut lesbar ist
    style: 'alwaysLight',
    paymentMethodOrder: ['card'],
    appearance: {
      colors: {
        primary: colors.accent,
        background: colors.background,
        componentBackground: colors.background,
        componentBorder: colors.borderStrong,
        componentDivider: colors.border,
        primaryText: colors.ink,
        secondaryText: colors.inkSecondary,
        componentText: colors.ink,
        placeholderText: colors.inkTertiary,
        icon: colors.accent,
        error: colors.danger,
      },
      shapes: { borderRadius: 14, borderWidth: 1.5 },
      primaryButton: {
        colors: { background: colors.accent, text: colors.onPrimary, border: colors.accent },
        shapes: { borderRadius: 14 },
      },
    },
  });
  if (init.error) throw new Error(init.error.localizedMessage ?? init.error.message);

  const { error } = await presentPaymentSheet();
  if (error) {
    if (error.code === PaymentSheetError.Canceled) return 'canceled';
    throw new Error(error.localizedMessage ?? error.message);
  }
  return 'paid';
}

/**
 * Bezahlen mit der gewählten Methode. Im Testmodus ("dev") wird TWINT über den gleichen
 * Server-Weg simuliert, Karte über die Testzahlung.
 */
export async function collectPayment(session: PaymentSession, method: PayMethod, bookingId: string): Promise<CollectResult> {
  if (method === 'twint') return payWithTwint(bookingId);
  if (session.provider === 'dev') return 'dev';
  return payWithSheet(session);
}
