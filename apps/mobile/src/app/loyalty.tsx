import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { TierProgress } from '@/features/bookings/Celebration';
import { dayLabel, pct, TIER, time } from '@/features/bookings/format';
import { useLoyalty } from '@/features/bookings/queries';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { colors, ErrorState, radius, Screen, SectionTitle, Skeleton, spacing, Text } from '@/ui';

const RULES = [
  { icon: 'car-outline', text: 'Jede abgeschlossene Buchung zählt 1 Punkt, als Mieter und als Vermieter.' },
  { icon: 'calendar-outline', text: 'Gezählt werden die letzten 12 Monate. Eine erreichte Stufe behältst du mindestens 12 Monate.' },
  { icon: 'shield-checkmark-outline', text: 'Nicht gezählt: Stornos, eigene Plätze, Buchungen unter 1 Std. oder unter CHF 5 und mehr als 5 Buchungen mit derselben Person.' },
  { icon: 'ticket-outline', text: 'Bei Events darfst du je nach Stufe früher buchen. Bestehende Buchungen anderer werden nie verdrängt.' },
] as const;

export default function LoyaltyScreen() {
  const q = useLoyalty();
  const events = useQuery({ queryKey: ['events'], queryFn: () => api.loyalty.events(), staleTime: 5 * 60_000 });

  if (q.isPending) {
    return (
      <Screen edges={['bottom']}>
        <Skeleton height={200} rounded={radius.xl} />
      </Screen>
    );
  }
  if (q.isError) return <ErrorState message={userMessage(q.error)} onRetry={() => void q.refetch()} />;
  const l = q.data;
  const t = TIER[l.tier];
  const idx = l.tiers.findIndex((x) => x.tier === l.tier);
  const current = l.tiers[idx]!;

  return (
    <Screen edges={['bottom']} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Stack.Screen options={{ title: 'Parkly Status' }} />
      <View style={[styles.hero, { backgroundColor: t.color }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Ionicons name={t.icon} size={28} color={colors.onPrimary} />
          <Text variant="title" tone="inverse">
            {t.label}
          </Text>
        </View>
        <Text variant="display" tone="inverse" style={{ marginTop: spacing.lg }}>
          {l.points}
        </Text>
        <Text variant="callout" style={{ color: 'rgba(255,255,255,0.85)' }}>
          {l.points === 1 ? 'Punkt' : 'Punkte'} in den letzten 12 Monaten
        </Text>
        <View style={styles.perks}>
          <Text variant="captionStrong" tone="inverse">
            Servicegebühr {pct(current.renterFeeBps)}
          </Text>
          <Text variant="captionStrong" tone="inverse">
            Vermietergebühr {pct(current.hostFeeBps)}
          </Text>
          {current.earlyAccessHours ? (
            <Text variant="captionStrong" tone="inverse">
              Event-Vorkauf {current.earlyAccessHours} Std.
            </Text>
          ) : null}
        </View>
        {l.heldUntil && l.tier !== 'BRONZE' ? (
          <Text variant="caption" style={{ color: 'rgba(255,255,255,0.8)', marginTop: spacing.sm }}>
            Gilt mindestens bis {new Date(l.heldUntil).toLocaleDateString('de-CH', { day: 'numeric', month: 'long', year: 'numeric' })}
          </Text>
        ) : null}
      </View>

      <View style={{ marginTop: spacing.xl }}>
        <TierProgress tier={l.tier} points={l.points} prevPoints={current.minPoints} nextTier={l.next?.tier ?? null} nextPoints={l.next?.minPoints ?? null} delay={250} />
      </View>

      <SectionTitle>Alle Stufen</SectionTitle>
      <View style={styles.table}>
        <View style={[styles.tr, styles.th]}>
          <Text variant="micro" tone="secondary" style={{ flex: 1.4 }}>
            STUFE
          </Text>
          <Text variant="micro" tone="secondary" style={styles.td}>
            MIETEN
          </Text>
          <Text variant="micro" tone="secondary" style={styles.td}>
            VERMIETEN
          </Text>
          <Text variant="micro" tone="secondary" style={styles.td}>
            VORKAUF
          </Text>
        </View>
        {l.tiers.map((x) => {
          const me = x.tier === l.tier;
          return (
            <View key={x.tier} style={[styles.tr, me && { backgroundColor: TIER[x.tier].soft }]}>
              <View style={{ flex: 1.4, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name={TIER[x.tier].icon} size={16} color={TIER[x.tier].color} />
                <View>
                  <Text variant="captionStrong">{TIER[x.tier].label}</Text>
                  <Text variant="caption" tone="tertiary">
                    ab {x.minPoints}
                  </Text>
                </View>
              </View>
              <Text variant="callout" style={styles.td}>
                {pct(x.renterFeeBps)}
              </Text>
              <Text variant="callout" style={styles.td}>
                {pct(x.hostFeeBps)}
              </Text>
              <Text variant="callout" style={styles.td}>
                {x.earlyAccessHours ? `${x.earlyAccessHours} h` : '–'}
              </Text>
            </View>
          );
        })}
      </View>

      {events.data?.length ? (
        <>
          <SectionTitle>Kommende Events</SectionTitle>
          <View style={{ gap: spacing.sm }}>
            {events.data.map((e) => {
              const open = e.yourAccessAt ? new Date(e.yourAccessAt) <= new Date() : false;
              return (
                <View key={e.id} style={styles.event}>
                  <Ionicons name="ticket-outline" size={20} color={colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{e.name}</Text>
                    <Text variant="caption" tone="secondary">
                      {dayLabel(new Date(e.startsAt))} {time(new Date(e.startsAt))} ·{' '}
                      {open ? 'Für dich schon buchbar' : e.yourAccessAt ? `Für dich ab ${dayLabel(new Date(e.yourAccessAt))} ${time(new Date(e.yourAccessAt))}` : ''}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      <SectionTitle>So funktioniert es</SectionTitle>
      <View style={{ gap: spacing.md }}>
        {RULES.map((r) => (
          <View key={r.text} style={{ flexDirection: 'row', gap: spacing.md }}>
            <Ionicons name={r.icon} size={20} color={colors.accent} />
            <Text variant="callout" tone="secondary" style={{ flex: 1 }}>
              {r.text}
            </Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xl, padding: spacing.xxl, marginTop: spacing.md },
  perks: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.lg },
  table: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  th: { borderTopWidth: 0, backgroundColor: colors.surface, paddingVertical: spacing.sm },
  td: { flex: 1, textAlign: 'right' },
  event: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
});
