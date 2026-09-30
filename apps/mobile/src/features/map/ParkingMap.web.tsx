import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { spacing, Text } from '@/ui';
import type { ParkingMapHandle, ParkingMapProps } from './ParkingMap';
import { ParkingPin } from './pins';

/**
 * Web-Platzhalter: react-native-maps läuft nur auf iOS/Android. Für die spätere Web-App
 * wird hier eine Web-Karte (z. B. MapLibre GL) eingesetzt. Bis dahin: Liste der Pins,
 * damit Bottom Sheet und Daten auch im Browser testbar sind.
 */
export const ParkingMap = forwardRef<ParkingMapHandle, ParkingMapProps>(function ParkingMap(props, ref) {
  useImperativeHandle(ref, () => ({
    animateTo: (region) => props.onRegionChange(region),
    flyTo: (t) => props.onRegionChange({ latitude: t.lat, longitude: t.lng, latitudeDelta: 0.012, longitudeDelta: 0.012 }),
  }));
  useEffect(() => {
    props.onRegionChange(props.initialRegion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#E9EEF3', paddingTop: props.topInset }]}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.md, paddingBottom: props.bottomInset }}>
        <Text variant="caption" tone="secondary">
          Kartenansicht ist in der App verfügbar (Web-Vorschau)
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {props.items.map((item) => (
            <Pressable key={item.id} onPress={() => props.onSelect(item)} accessibilityLabel={item.name}>
              <ParkingPin item={item} selected={item.id === props.selectedId} />
            </Pressable>
          ))}
        </View>
        {props.clusters.length ? (
          <Text variant="caption" tone="secondary">
            {props.clusters.reduce((s, c) => s + c.count, 0)} Parkplätze in {props.clusters.length} Gruppen
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
});
