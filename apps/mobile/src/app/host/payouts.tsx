import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as WebBrowser from 'expo-web-browser';
import { money } from '@/features/bookings/format';
import { usePayouts } from '@/features/bookings/queries';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { Banner, Button, colors, ErrorState, radius, Screen, Skeleton, spacing, Text } from '@/ui';

/** Auszahlungen: Stripe-Konto einrichten und Beträge sehen. */
export default function Payouts() {
  const q = usePayouts();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (q.isPending) {
    return (
      <Screen edges={['bottom']}>
        <Skeleton height={160} rounded={radius.lg} />
      </Screen>
    );
  }
  if (q.isError) return <ErrorState message={userMessage(q.error)} onRetry={() => void q.refetch()} />;
  const p = q.data;

  const onboard = async () => {
    setError(null);
    setBusy(true);
    try {
      const url = await api.hostBookings.onboardingLink();
      await WebBrowser.openBrowserAsync(url);
      await q.refetch();
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = p.payoutsEnabled;
  return (
    <Screen
      edges={['bottom']}
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
      footer={
        p.provider === 'stripe' && !ready ? (
          <Button title={p.connected ? 'Angaben vervollständigen' : 'Auszahlungen einrichten'} icon="open-outline" loading={busy} onPress={() => void onboard()} />
        ) : undefined
      }
    >
      <Stack.Screen options={{ title: 'Auszahlungen' }} />
      <View style={styles.cards}>
        <View style={styles.card}>
          <Text variant="caption" tone="secondary">
            Unterwegs zu dir
          </Text>
          <Text variant="title">{money(p.pendingAmount, p.currency)}</Text>
        </View>
        <View style={styles.card}>
          <Text variant="caption" tone="secondary">
            Bereits ausbezahlt
          </Text>
          <Text variant="title">{money(p.transferredAmount, p.currency)}</Text>
        </View>
      </View>

      <View style={[styles.status, { backgroundColor: ready ? colors.successSoft : colors.warningSoft }]}>
        <Ionicons name={ready ? 'checkmark-circle' : 'alert-circle-outline'} size={22} color={ready ? colors.success : colors.warning} />
        <Text variant="callout" style={{ flex: 1 }}>
          {p.provider === 'dev'
            ? 'Testmodus: Auszahlungen werden nur simuliert. Mit Stripe richtest du hier dein Konto ein.'
            : ready
              ? 'Dein Auszahlungskonto ist bereit. Wir zahlen 24 Stunden nach jeder Buchung aus.'
              : p.connected
                ? 'Stripe braucht noch Angaben von dir, bevor wir auszahlen können. Deine Einnahmen warten so lange.'
                : 'Richte dein Auszahlungskonto ein (IBAN und Ausweis bei Stripe). Deine Einnahmen warten, bis es bereit ist.'}
        </Text>
      </View>
      {error ? <Banner>{error}</Banner> : null}
      <Text variant="caption" tone="tertiary" style={{ marginTop: spacing.lg }}>
        Parkly nutzt Stripe für Zahlungen und Auszahlungen. Deine Bank- und Ausweisdaten gibst du direkt bei Stripe ein, Parkly speichert sie nicht.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cards: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  card: { flex: 1, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.xs },
  status: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', padding: spacing.lg, borderRadius: radius.lg, marginVertical: spacing.xl },
});
