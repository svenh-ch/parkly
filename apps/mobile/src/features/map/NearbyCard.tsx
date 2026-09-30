import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { formatDistance, type MapItem } from '@parking/shared';
import { Card, colors, radius, spacing, Text } from '@/ui';
import { kindLabel, occupancyColor, occupancyLevel, occupancyText, priceLabel } from './format';
import { FavoriteButton, RatingInline } from '@/features/social/components';

/** Card für "Parkplätze in deiner Nähe" auf dem Home Screen. */
export function NearbyCard({ item }: { item: MapItem & { distanceMeters: number | null } }) {
  const isPublic = item.kind === 'PUBLIC_PARKING';
  const level = occupancyLevel(item.occupancy, item.capacity);

  const open = () =>
    isPublic
      ? router.push({ pathname: '/facility/[id]', params: { id: item.id } })
      : router.push({ pathname: '/spot/[id]', params: { id: item.id } });

  return (
    <Card onPress={open} style={styles.card}>
      <View style={[styles.thumb, { backgroundColor: isPublic ? colors.publicParkingAccent : colors.primary }]}>
        <Text variant="headline" tone="inverse">
          P
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {item.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text variant="caption" tone="secondary">
            {kindLabel(item)}
            {item.distanceMeters !== null ? ` · ${formatDistance(item.distanceMeters)}` : ''}
          </Text>
          <RatingInline rating={item.rating} />
        </View>
        {isPublic && !item.occupancy ? (
          <Text variant="caption" tone="tertiary" numberOfLines={1}>
            {item.capacity ? `${item.capacity} Plätze · ` : ''}Keine Live-Daten
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        {isPublic && !item.occupancy ? null : isPublic ? (
          <>
            <Text variant="captionStrong" style={{ color: level === 'unknown' ? colors.inkSecondary : occupancyColor[level] }}>
              {occupancyText(item.occupancy, item.capacity)}
            </Text>
            {item.occupancy?.isLive ? (
              <Text variant="micro" tone="tertiary">
                LIVE
              </Text>
            ) : null}
          </>
        ) : item.price ? (
          <Text variant="captionStrong">{priceLabel(item.price)}</Text>
        ) : null}
      </View>
      <FavoriteButton target={{ kind: item.kind, id: item.id }} isFavorite={item.isFavorite} size={20} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  thumb: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
