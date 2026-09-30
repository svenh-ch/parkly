import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { MapItem } from '@parking/shared';
import { colors, radius, Text } from '@/ui';
import { occupancyColor, occupancyLevel, pinPriceLabel } from './format';

/**
 * Visuelle Pins (nur Darstellung, ohne Kartenlogik), damit sie auch ausserhalb der
 * Karte wiederverwendbar und testbar sind.
 */

export function ParkingPin({ item, selected }: { item: MapItem; selected: boolean }) {
  return (
    <View style={styles.frame}>
      {item.isFavorite ? <FavoritePin item={item} selected={selected} /> : <PinBody item={item} selected={selected} />}
    </View>
  );
}

/**
 * Favoriten: komplett ausgefüllter Pin in eigener Farbe mit Herz, damit man ihn auf
 * einen Blick zwischen allen anderen Pins erkennt.
 */
function FavoritePin({ item, selected }: { item: MapItem; selected: boolean }) {
  const level = occupancyLevel(item.occupancy, item.capacity);
  const label =
    item.kind === 'PRIVATE_MARKETPLACE_PARKING'
      ? item.price
        ? pinPriceLabel(item.price)
        : 'Privat'
      : level === 'high' || level === 'low'
        ? String(item.occupancy!.freeSpaces)
        : level === 'full'
          ? 'voll'
          : 'P';
  return (
    <View
      style={[styles.pill, styles.shadow, styles.favorite, selected && styles.favoriteSelected]}
      accessibilityLabel={`Favorit: ${item.name}`}
    >
      <Ionicons name="heart" size={14} color={colors.onPrimary} />
      <Text variant="captionStrong" tone="inverse">
        {label}
      </Text>
    </View>
  );
}

function PinBody({ item, selected }: { item: MapItem; selected: boolean }) {
  if (item.kind === 'PRIVATE_MARKETPLACE_PARKING') {
    return (
      <View style={[styles.pill, styles.shadow, selected ? styles.privateSelected : styles.private]}>
        <Text variant="captionStrong" style={{ color: selected ? colors.primary : colors.onPrimary }}>
          {item.price ? pinPriceLabel(item.price) : 'Privat'}
        </Text>
      </View>
    );
  }

  const level = occupancyLevel(item.occupancy, item.capacity);
  const showFree = level === 'high' || level === 'low';
  return (
    <View style={[styles.pill, styles.shadow, styles.public, selected && styles.publicSelected]}>
      <View style={[styles.pBadge, selected && { backgroundColor: colors.onPrimary }]}>
        <Text variant="micro" style={{ color: selected ? colors.primary : colors.onPrimary, fontSize: 11 }}>
          P
        </Text>
      </View>
      {showFree || level === 'full' ? (
        <Text variant="captionStrong" style={{ color: selected ? colors.onPrimary : colors.ink }}>
          {level === 'full' ? 'voll' : item.occupancy!.freeSpaces}
        </Text>
      ) : null}
      {showFree ? <View style={[styles.dot, { backgroundColor: occupancyColor[level] }]} /> : null}
    </View>
  );
}

export function ClusterPin({ count }: { count: number }) {
  const size = count < 10 ? 36 : count < 100 ? 44 : 52;
  return (
    <View style={[styles.cluster, styles.shadow, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text variant="captionStrong" tone="inverse">
        {count > 999 ? '999+' : count}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { padding: 4 },
  favorite: {
    backgroundColor: colors.favorite,
    borderColor: colors.background,
    borderWidth: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  favoriteSelected: { backgroundColor: colors.favoritePressed, transform: [{ scale: 1.12 }] },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  shadow: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  private: { backgroundColor: colors.marketplace, borderColor: colors.marketplace, paddingHorizontal: 10 },
  privateSelected: { backgroundColor: colors.background, borderColor: colors.primary, transform: [{ scale: 1.1 }] },
  public: { backgroundColor: colors.publicParking, borderColor: colors.border },
  publicSelected: { backgroundColor: colors.primary, borderColor: colors.primary, transform: [{ scale: 1.1 }] },
  pBadge: {
    width: 18,
    height: 18,
    borderRadius: 5,
    backgroundColor: colors.publicParkingAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  cluster: {
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
