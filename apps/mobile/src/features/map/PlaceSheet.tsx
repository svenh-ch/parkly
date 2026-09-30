import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatDistance, formatDuration, type NearbyItem } from '@parking/shared';
import { userMessage } from '@/lib/errors';
import { colors, radius, shadows, spacing, Text } from '@/ui';
import { occupancyColor, occupancyLevel, occupancyText, priceLabel } from './format';
import { usePlaceParking } from './queries';

/**
 * "Parken bei …": fährt nach einer Ortssuche von unten hoch und listet die nächsten
 * Parkhäuser und privaten Plätze, sortiert nach Gehdistanz zum gesuchten Ort.
 */
export function PlaceSheet({
  place,
  bottomInset,
  onSelect,
  onClose,
}: {
  place: { lat: number; lng: number; label: string };
  bottomInset: number;
  onSelect: (item: NearbyItem) => void;
  onClose: () => void;
}) {
  const query = usePlaceParking(place);
  const translateY = useRef(new Animated.Value(500)).current;

  useEffect(() => {
    translateY.setValue(500);
    // Kurz warten, bis der Kamera-Flug angelaufen ist
    const t = setTimeout(
      () => Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 180 }).start(),
      450,
    );
    return () => clearTimeout(t);
  }, [place.lat, place.lng, translateY]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => translateY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 100 || g.vy > 0.8) {
          Animated.timing(translateY, { toValue: 600, duration: 180, useNativeDriver: true }).start(onClose);
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  const items = query.data ?? [];

  return (
    <Animated.View style={[styles.sheet, shadows.floating, { bottom: bottomInset, transform: [{ translateY }] }]}>
      <View {...pan.panHandlers}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={styles.pin}>
            <Ionicons name="location" size={18} color={colors.onPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="secondary">
              Parken bei
            </Text>
            <Text variant="headline" numberOfLines={1}>
              {place.label}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Schliessen" style={styles.close}>
            <Ionicons name="close" size={20} color={colors.inkSecondary} />
          </Pressable>
        </View>
      </View>

      {query.isPending ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.accent} />
          <Text variant="callout" tone="secondary">
            Suche Parkplätze in der Nähe …
          </Text>
        </View>
      ) : query.isError ? (
        <Pressable style={styles.state} onPress={() => void query.refetch()}>
          <Text variant="callout" tone="danger">
            {userMessage(query.error)} · Erneut versuchen
          </Text>
        </Pressable>
      ) : items.length === 0 ? (
        <View style={styles.state}>
          <Text variant="callout" tone="secondary">
            Hier haben wir noch keine Parkhäuser oder privaten Plätze.
          </Text>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 290 }} contentContainerStyle={{ paddingBottom: spacing.sm }}>
          {items.map((item, idx) => (
            <PlaceRow key={item.id} item={item} first={idx === 0} onPress={() => onSelect(item)} />
          ))}
        </ScrollView>
      )}
    </Animated.View>
  );
}

function PlaceRow({ item, first, onPress }: { item: NearbyItem; first: boolean; onPress: () => void }) {
  const isPublic = item.kind === 'PUBLIC_PARKING';
  const level = occupancyLevel(item.occupancy, item.capacity);
  const walk =
    item.walkMeters != null && item.walkSeconds != null
      ? `${formatDuration(item.walkSeconds)} zu Fuss · ${formatDistance(item.walkMeters)}`
      : `${formatDistance(item.distanceMeters)} Luftlinie`;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
      accessibilityRole="button"
    >
      <View style={[styles.thumb, { backgroundColor: isPublic ? colors.publicParkingAccent : colors.primary }]}>
        <Text variant="bodyStrong" tone="inverse">
          P
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {item.name}
        </Text>
        <View style={styles.meta}>
          <Ionicons name="walk" size={13} color={colors.inkSecondary} />
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {walk}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        {isPublic && item.occupancy ? (
          <View style={styles.meta}>
            <View style={[styles.dot, { backgroundColor: occupancyColor[level] }]} />
            <Text variant="captionStrong" numberOfLines={1}>
              {occupancyText(item.occupancy, item.capacity)}
            </Text>
          </View>
        ) : isPublic && item.capacity ? (
          <Text variant="captionStrong">{item.capacity} Plätze</Text>
        ) : item.price ? (
          <Text variant="captionStrong">{priceLabel(item.price)}</Text>
        ) : null}
        {isPublic && !item.occupancy ? (
          <Text variant="caption" tone="tertiary">
            Keine Live-Daten
          </Text>
        ) : first ? (
          <Text variant="caption" style={{ color: colors.success }}>
            Am nächsten
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.md },
  pin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  state: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  thumb: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
