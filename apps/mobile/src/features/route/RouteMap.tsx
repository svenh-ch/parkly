import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { cameraForSpeed } from '@parking/shared';
import { colors } from '@/ui';
import { CarIcon, DestinationPin } from './icons';

export interface RouteMapHandle {
  /** Ganze Route einpassen (Übersicht). */
  fit(): void;
  /** Ganze restliche Route zeigen, ohne die Navigation zu beenden. */
  overview(): void;
  /** Kamera folgt dem Auto (Navigationsmodus). */
  follow(center: { lat: number; lng: number }, bearing: number, speed: number | null | undefined): void;
}

export interface RouteMapProps {
  /** Noch zu fahrende Linie als [lat, lng]. */
  line: [number, number][];
  destination: { lat: number; lng: number };
  car: { lat: number; lng: number; bearing: number } | null;
  navigating: boolean;
  /** Kamera folgt gerade dem Auto (sonst hat der Nutzer die Karte bewegt). */
  following?: boolean;
  topInset: number;
  bottomInset: number;
  /** Nutzer berührt die Karte (Folgen pausieren). */
  onUserInteract?: () => void;
}

export const RouteMap = forwardRef<RouteMapHandle, RouteMapProps>(function RouteMap(props, ref) {
  const mapRef = useRef<MapView>(null);
  // Tatsächliche Ausrichtung der Karte: das Auto wird relativ dazu gedreht,
  // damit es auch nach einem Drehen der Karte von Hand in Fahrtrichtung zeigt.
  const [cameraHeading, setCameraHeading] = useState(0);
  const lastHeadingRead = useRef(0);
  const readHeading = () => {
    void mapRef.current
      ?.getCamera()
      .then((c) => setCameraHeading(c.heading ?? 0))
      .catch(() => undefined);
  };
  const latLngs = useMemo(() => props.line.map(([latitude, longitude]) => ({ latitude, longitude })), [props.line]);
  const allRef = useRef(latLngs);
  allRef.current = latLngs;

  const fit = () => {
    const pts = allRef.current;
    if (pts.length < 2) return;
    mapRef.current?.fitToCoordinates(pts, {
      edgePadding: { top: props.topInset + 48, bottom: props.bottomInset + 48, left: 48, right: 48 },
      animated: true,
    });
  };

  useImperativeHandle(ref, () => ({
    fit,
    overview: () => {
      fit();
      setTimeout(readHeading, 700);
    },
    follow(center, bearing, speed) {
      const cam = cameraForSpeed(speed);
      setCameraHeading(bearing);
      mapRef.current?.animateCamera(
        {
          center: { latitude: center.lat, longitude: center.lng },
          heading: bearing,
          pitch: cam.pitch,
          altitude: cam.altitude, // iOS (Apple Maps)
          zoom: cam.zoom, // Android (Google Maps)
        },
        { duration: 900 },
      );
    },
  }));

  const first = props.line[0]!;
  return (
    <View
      style={StyleSheet.absoluteFill}
      onTouchStart={props.navigating ? props.onUserInteract : undefined}
    >
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: first[0], longitude: first[1], latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        onMapReady={fit}
        onRegionChange={() => {
          // Während der Nutzer dreht: Richtung höchstens alle 150 ms nachlesen
          if (!props.navigating || props.following) return;
          const now = Date.now();
          if (now - lastHeadingRead.current > 150) {
            lastHeadingRead.current = now;
            readHeading();
          }
        }}
        onRegionChangeComplete={() => {
          if (props.navigating && !props.following) readHeading();
        }}
        showsUserLocation={!props.navigating}
        showsMyLocationButton={false}
        showsCompass={props.navigating && !props.following}
        showsPointsOfInterests={false}
        showsBuildings
        pitchEnabled
        rotateEnabled
        scrollEnabled
        zoomEnabled
        toolbarEnabled={false}
        mapPadding={{ top: props.topInset, bottom: props.bottomInset, left: 0, right: 0 }}
      >
        {latLngs.length >= 2 ? (
          <>
            <Polyline coordinates={latLngs} strokeColor={colors.primary} strokeWidth={10} lineCap="round" lineJoin="round" zIndex={1} />
            <Polyline coordinates={latLngs} strokeColor={colors.accent} strokeWidth={6} lineCap="round" lineJoin="round" zIndex={2} />
          </>
        ) : null}
        <Marker
          coordinate={{ latitude: props.destination.lat, longitude: props.destination.lng }}
          anchor={{ x: 0.5, y: 1 }}
          tracksViewChanges={false}
          zIndex={10}
        >
          <DestinationPin />
        </Marker>
        {props.car ? (
          <Marker
            coordinate={{ latitude: props.car.lat, longitude: props.car.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            tracksViewChanges
            zIndex={50}
          >
            <CarIcon rotation={props.car.bearing - cameraHeading} />
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
});
