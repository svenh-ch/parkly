import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Confetti, Rise, SuccessCheck, TierProgress } from '@/features/bookings/Celebration';
import { Ticket } from '@/features/bookings/Ticket';
import { scheduleEndReminder } from '@/features/bookings/reminders';
import { useBooking, useLoyalty } from '@/features/bookings/queries';
import { openInAppRoute } from '@/features/route/open';
import { Button, colors, gutter, spacing, Text } from '@/ui';

/** Der Moment nach dem Bezahlen: Haken, Konfetti, Ticket und Status-Fortschritt. */
export default function BookingSuccess() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind?: string }>();
  const booking = useBooking(id);
  const loyalty = useLoyalty();
  const b = booking.data;
  const extended = kind === 'extended';
  const request = b?.status === 'PENDING_APPROVAL';

  useEffect(() => {
    if (b) void scheduleEndReminder(b);
  }, [b]);

  const l = loyalty.data;
  const idx = l ? l.tiers.findIndex((t) => t.tier === l.tier) : -1;
  const prevPoints = l && idx >= 0 ? l.tiers[idx]!.minPoints : 0;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center', marginTop: -spacing.md }}>
          <SuccessCheck />
          <Rise delay={450}>
            <Text variant="display" align="center">
              {extended ? 'Verlängert!' : request ? 'Anfrage gesendet!' : 'Gebucht!'}
            </Text>
          </Rise>
          <Rise delay={550}>
            <Text variant="body" tone="secondary" align="center" style={{ marginTop: spacing.xs, paddingHorizontal: spacing.xl }}>
              {extended
                ? 'Deine Parkzeit wurde verlängert.'
                : request
                  ? 'Bezahlt. Der Vermieter bestätigt innert 24 Stunden, sonst erhältst du alles zurück.'
                  : 'Dein Parkplatz ist reserviert. Wir erinnern dich 15 Minuten vor Ende.'}
            </Text>
          </Rise>
        </View>

        {l && !extended ? (
          <Rise delay={700}>
            <TierProgress
              tier={l.tier}
              points={l.points}
              prevPoints={prevPoints}
              nextTier={l.next?.tier ?? null}
              nextPoints={l.next?.minPoints ?? null}
              pendingPoints={b && b.subtotal >= 500 && new Date(b.endAt).getTime() - new Date(b.startAt).getTime() >= 3_600_000 ? 1 : 0}
              delay={1100}
            />
          </Rise>
        ) : null}
        {b ? (
          <Rise delay={850}>
            <Ticket b={b} />
          </Rise>
        ) : null}

      </ScrollView>

      <View style={styles.footer}>
        {b && !request ? (
          <Button title="Route starten" icon="navigate" onPress={() => openInAppRoute({ lat: b.spot.lat, lng: b.spot.lng, name: b.spot.title })} />
        ) : null}
        <Button title="Fertig" variant={b && !request ? 'ghost' : 'primary'} onPress={() => (b ? router.replace({ pathname: '/booking/[id]', params: { id: b.id } }) : router.replace('/bookings'))} />
      </View>
      <Confetti count={extended ? 24 : 48} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { padding: gutter, gap: spacing.xl, paddingBottom: spacing.huge },
  footer: { paddingHorizontal: gutter, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.xs, backgroundColor: colors.surface },
});
