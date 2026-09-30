import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ManeuverType } from '@parking/shared';
import { colors, Text } from '@/ui';

type McIcon = ComponentProps<typeof MaterialCommunityIcons>['name'];

const ICONS: Record<ManeuverType, McIcon> = {
  DEPART: 'navigation',
  STRAIGHT: 'arrow-up',
  SLIGHT_LEFT: 'arrow-top-left',
  LEFT: 'arrow-left-top',
  SHARP_LEFT: 'arrow-left-bottom',
  SLIGHT_RIGHT: 'arrow-top-right',
  RIGHT: 'arrow-right-top',
  SHARP_RIGHT: 'arrow-right-bottom',
  KEEP_LEFT: 'arrow-top-left',
  KEEP_RIGHT: 'arrow-top-right',
  UTURN: 'arrow-u-left-top',
  ROUNDABOUT: 'rotate-right',
  EXIT_ROUNDABOUT: 'arrow-top-right',
  MERGE: 'call-merge',
  RAMP: 'arrow-top-right',
  ARRIVE: 'flag-checkered',
};

export function ManeuverIcon({ type, size = 36, color = colors.onPrimary }: { type: ManeuverType; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={ICONS[type]} size={size} color={color} />;
}

/**
 * Auto von oben (wie bei Uber), in Parkly-Navy. `rotation` in Grad relativ zur Kartenausrichtung.
 */
export function CarIcon({ rotation = 0 }: { rotation?: number }) {
  return (
    <View style={car.wrap} pointerEvents="none">
      <View style={car.halo} />
      <View style={[car.body, { transform: [{ rotate: `${rotation}deg` }] }]}>
        <View style={car.windshield} />
        <View style={car.roof} />
        <View style={car.rear} />
      </View>
    </View>
  );
}

/** Zielpunkt: Parkly-"P" mit weissem Rand. */
export function DestinationPin() {
  return (
    <View style={dest.wrap}>
      <View style={dest.bubble}>
        <Text variant="bodyStrong" style={{ color: colors.onPrimary, fontWeight: '800' }}>
          P
        </Text>
      </View>
      <View style={dest.tip} />
    </View>
  );
}

const car = StyleSheet.create({
  wrap: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(31, 79, 216, 0.16)',
  },
  body: {
    width: 22,
    height: 40,
    borderRadius: 9,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.onPrimary,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  windshield: { marginTop: 7, width: 14, height: 8, borderRadius: 3, backgroundColor: '#8FB0FF' },
  roof: { marginTop: 2, width: 14, height: 10, borderRadius: 2, backgroundColor: '#0B2A6F' },
  rear: { marginTop: 2, width: 12, height: 4, borderRadius: 2, backgroundColor: '#8FB0FF' },
});

const dest = StyleSheet.create({
  wrap: { alignItems: 'center' },
  bubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.onPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  tip: {
    width: 0,
    height: 0,
    marginTop: -2,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: colors.onPrimary,
  },
});
