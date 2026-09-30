import { Image, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Booking } from '@parking/shared';
import { mediaUrl } from '@/lib/media';
import { colors, radius, shadows, spacing, Text } from '@/ui';
import { BOOKING_STATUS, money, rangeLabel } from './format';

/** Buchung in Listen (Mieter und Vermieter). */
export function BookingCard({ b }: { b: Booking }) {
  const st = BOOKING_STATUS[b.status];
  const running = b.status === 'CONFIRMED' && new Date(b.startAt).getTime() <= Date.now() && new Date(b.endAt).getTime() > Date.now();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/booking/[id]', params: { id: b.id } })}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, shadows.card, pressed && { transform: [{ scale: 0.99 }] }]}
    >
      {b.spot.coverUrl ? (
        <Image source={{ uri: mediaUrl(b.spot.coverUrl) }} style={styles.cover} />
      ) : (
        <View style={[styles.cover, { alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name="car-outline" size={24} color={colors.inkTertiary} />
        </View>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={[styles.pill, { backgroundColor: running ? colors.success : st.bg }]}>
            <Text variant="micro" style={{ color: running ? colors.onPrimary : st.color }}>
              {(running ? 'Läuft' : st.label).toUpperCase()}
            </Text>
          </View>
        </View>
        <Text variant="bodyStrong" numberOfLines={1}>
          {b.spot.title}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {rangeLabel(b.startAt, b.endAt)}
        </Text>
        <Text variant="caption" tone="tertiary" numberOfLines={1}>
          {b.role === 'HOST' ? `${b.counterpart.firstName ?? 'Mieter'} · ${money(b.hostPayout, b.currency)}` : `${b.spot.area} · ${money(b.total, b.currency)}`}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.inkTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.background, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  cover: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.surface },
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
});
