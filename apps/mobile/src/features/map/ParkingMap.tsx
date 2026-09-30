import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import type { MapCluster, MapItem } from '@parking/shared';
import { ClusterPin, ParkingPin } from './pins';
import { colors } from '@/ui';
import type { MapRegion } from './queries';

export interface ParkingMapHandle {
  animateTo(region: MapRegion, durationMs?: number): void;
  /** Kamera-Flug: kurz herauszoomen, dann sanft auf das Ziel. */
  flyTo(target: { lat: number; lng: number }, from?: { lat: number; lng: number } | null): void;
}

export interface ParkingMapProps {
  initialRegion: MapRegion;
  items: MapItem[];
  clusters: MapCluster[];
  selectedId: string | null;
  showsUserLocation: boolean;
  bottomInset: number;
  topInset: number;
  onRegionChange: (region: MapRegion) => void;
  onSelect: (item: MapItem) => void;
  onClusterPress: (cluster: MapCluster) => void;
  onMapPress: () => void;
  /** Gesuchter Ort (Ortssuche), als eigener Pin dargestellt. */
  destination?: { lat: number; lng: number; label: string } | null;
}

/**
 * Marker neu zeichnen nur, wenn sich ihr Inhalt ändert. tracksViewChanges dauerhaft auf true
 * kostet auf Android/iOS viel Performance bei vielen Pins.
 */
function StableMarker({
  coordinate,
  onPress,
  children,
  version,
  zIndex,
}: {
  coordinate: { latitude: number; longitude: number };
  onPress: () => void;
  children: ReactNode;
  version: string;
  zIndex?: number;
}) {
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    setTracks(true);
    const t = setTimeout(() => setTracks(false), 500);
    return () => clearTimeout(t);
  }, [version]);
  return (
    <Marker
      coordinate={coordinate}
      onPress={(e) => {
        e.stopPropagation();
        onPress();
      }}
      tracksViewChanges={tracks}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={zIndex}
      stopPropagation
    >
      {children}
    </Marker>
  );
}

export const ParkingMap = forwardRef<ParkingMapHandle, ParkingMapProps>(function ParkingMap(props, ref) {
  const mapRef = useRef<MapView>(null);

  const flyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (flyTimer.current) clearTimeout(flyTimer.current);
  }, []);

  useImperativeHandle(ref, () => ({
    animateTo: (region, durationMs = 450) => mapRef.current?.animateToRegion(region, durationMs),
    flyTo: (target, from) => {
      const map = mapRef.current;
      if (!map) return;
      if (flyTimer.current) clearTimeout(flyTimer.current);
      const end = { latitude: target.lat, longitude: target.lng, latitudeDelta: 0.012, longitudeDelta: 0.012 };
      if (!from) {
        map.animateToRegion(end, 900);
        return;
      }
      // Weite Strecke: erst Überblick über Start und Ziel, dann hineinfliegen
      const span = Math.max(Math.abs(from.lat - target.lat), Math.abs(from.lng - target.lng));
      if (span < 0.02) {
        map.animateToRegion(end, 800);
        return;
      }
      const mid = {
        latitude: (from.lat + target.lat) / 2,
        longitude: (from.lng + target.lng) / 2,
        latitudeDelta: Math.min(span * 1.8, 60),
        longitudeDelta: Math.min(span * 1.8, 60),
      };
      map.animateToRegion(mid, 650);
      flyTimer.current = setTimeout(() => map.animateToRegion(end, 1100), 700);
    },
  }));

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={props.initialRegion}
      onRegionChangeComplete={(r: Region) => props.onRegionChange(r)}
      onPress={props.onMapPress}
      showsUserLocation={props.showsUserLocation}
      showsMyLocationButton={false}
      showsCompass={false}
      showsPointsOfInterests={false}
      pitchEnabled={false}
      toolbarEnabled={false}
      rotateEnabled={false}
      mapPadding={{ top: props.topInset, bottom: props.bottomInset, left: 0, right: 0 }}
    >
      {props.destination ? (
        <Marker
          coordinate={{ latitude: props.destination.lat, longitude: props.destination.lng }}
          title={props.destination.label}
          pinColor={colors.accent}
          zIndex={30}
        />
      ) : null}
      {props.clusters.map((c) => (
        <StableMarker
          key={`c-${c.lat.toFixed(4)}-${c.lng.toFixed(4)}`}
          version={String(c.count)}
          coordinate={{ latitude: c.lat, longitude: c.lng }}
          onPress={() => props.onClusterPress(c)}
        >
          <ClusterPin count={c.count} />
        </StableMarker>
      ))}
      {props.items.map((item) => {
        const selected = item.id === props.selectedId;
        return (
          <StableMarker
            key={item.id}
            version={`${selected}-${item.isFavorite}-${item.occupancy?.freeSpaces ?? ''}-${item.occupancy?.isLive ?? ''}-${item.price?.amount ?? ''}`}
            coordinate={{ latitude: item.lat, longitude: item.lng }}
            onPress={() => props.onSelect(item)}
            zIndex={selected ? 20 : item.isFavorite ? 10 : item.kind === 'PRIVATE_MARKETPLACE_PARKING' ? 2 : 1}
          >
            <ParkingPin item={item} selected={selected} />
          </StableMarker>
        );
      })}
    </MapView>
  );
});
