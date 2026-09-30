import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { colors, radius, spacing, Text } from '@/ui';

/** Karte mit verschiebbarem Pin für die genaue Position des Parkplatzes. */
export function LocationPicker({
  value,
  onChange,
}: {
  value: { lat: number; lng: number };
  onChange: (p: { lat: number; lng: number }) => void;
}) {
  const ref = useRef<MapView>(null);
  const last = useRef(value);
  useEffect(() => {
    // Nach einer Adresssuche: Karte dorthin bewegen (nicht bei jedem Verschieben)
    if (Math.abs(last.current.lat - value.lat) > 0.002 || Math.abs(last.current.lng - value.lng) > 0.002) {
      ref.current?.animateToRegion({ latitude: value.lat, longitude: value.lng, latitudeDelta: 0.003, longitudeDelta: 0.003 }, 500);
    }
    last.current = value;
  }, [value]);

  return (
    <View style={styles.wrap}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: value.lat, longitude: value.lng, latitudeDelta: 0.003, longitudeDelta: 0.003 }}
        onPress={(e) => onChange({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
        showsPointsOfInterests={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
      >
        <Marker
          coordinate={{ latitude: value.lat, longitude: value.lng }}
          draggable
          onDragEnd={(e) => onChange({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
          pinColor={colors.accent}
        />
      </MapView>
      <View style={styles.hint} pointerEvents="none">
        <Text variant="caption" style={{ color: colors.onPrimary }}>
          Pin gedrückt halten und auf deinen Platz ziehen
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 240, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface },
  hint: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: 'rgba(1, 24, 74, 0.85)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
});
