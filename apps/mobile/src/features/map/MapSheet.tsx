import { useEffect, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { distanceMeters, formatDistance, type MapItem } from '@parking/shared';
import type { Coordinates } from '@/features/location/LocationProvider';
import { Badge, Button, colors, radius, shadows, spacing, Text } from '@/ui';
import { kindLabel, occupancyColor, occupancyLevel, occupancyText, priceLabel, relativeTime } from './format';
import { openInAppRoute } from '@/features/route/open';
import { FavoriteButton, RatingInline } from '@/features/social/components';

/**
 * Bottom Sheet für einen ausgewählten Pin: Bild/Icon, Name, Preis bzw. Belegung, Entfernung,
 * Route und Details. Nach unten wischen schliesst.
 */
export function MapSheet({
  item,
  userCoords,
  bottomInset,
  onClose,
}: {
  item: MapItem;
  userCoords: Coordinates | null;
  bottomInset: number;
  onClose: () => void;
}) {
  const translateY = useRef(new Animated.Value(320)).current;

  useEffect(() => {
    translateY.setValue(320);
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 220 }).start();
  }, [item.id, translateY]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => translateY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.8) {
          Animated.timing(translateY, { toValue: 400, duration: 180, useNativeDriver: true }).start(onClose);
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  const distance = userCoords ? formatDistance(distanceMeters(userCoords, item)) : null;
  const isPublic = item.kind === 'PUBLIC_PARKING';
  const level = occupancyLevel(item.occupancy, item.capacity);

  return (
    <Animated.View
      {...pan.panHandlers}
      style={[styles.sheet, shadows.floating, { bottom: bottomInset, transform: [{ translateY }] }]}
      accessibilityViewIsModal
    >
      <View style={styles.handle} />
      <View style={styles.row}>
        <View style={[styles.thumb, { backgroundColor: isPublic ? colors.publicParkingAccent : colors.primary }]}>
          <Text variant="title" tone="inverse">
            P
          </Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge label={kindLabel(item)} tone={isPublic ? 'neutral' : 'primary'} />
            <RatingInline rating={item.rating} />
            {distance ? (
              <Text variant="caption" tone="secondary">
                {distance} entfernt
              </Text>
            ) : null}
          </View>
          <Text variant="headline" numberOfLines={2}>
            {item.name}
          </Text>
          {isPublic ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={[styles.dot, { backgroundColor: occupancyColor[level] }]} />
              <Text variant="callout" style={{ color: level === 'unknown' ? colors.inkSecondary : colors.ink }}>
                {occupancyText(item.occupancy, item.capacity)}
              </Text>
              {item.occupancy?.isLive ? (
                <Text variant="caption" tone="tertiary">
                  · live, {relativeTime(item.occupancy.observedAt)}
                </Text>
              ) : null}
            </View>
          ) : item.price ? (
            <Text variant="bodyStrong">{priceLabel(item.price)}</Text>
          ) : null}
        </View>
        <View style={{ gap: spacing.md, alignItems: 'center' }}>
          <Ionicons name="close" size={22} color={colors.inkTertiary} onPress={onClose} accessibilityLabel="Schliessen" />
          <FavoriteButton target={{ kind: item.kind, id: item.id }} isFavorite={item.isFavorite} />
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          title="Route"
          icon="navigate"
          size="md"
          style={{ flex: 1 }}
          onPress={() =>
            openInAppRoute({
              lat: item.lat,
              lng: item.lng,
              name: item.name,
              facilityId: item.kind === 'PUBLIC_PARKING' ? item.id : undefined,
            })
          }
        />
        <Button
          title="Details"
          variant="secondary"
          size="md"
          style={{ flex: 1 }}
          onPress={() =>
            isPublic
              ? router.push({ pathname: '/facility/[id]', params: { id: item.id } })
              : router.push({ pathname: '/spot/[id]', params: { id: item.id } })
          }
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    padding: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.lg,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  thumb: { width: 64, height: 64, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  actions: { flexDirection: 'row', gap: spacing.md },
});
