import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { MapCluster, MapItem, ParkingKind } from '@parking/shared';
import { DEFAULT_CENTER, useLocation } from '@/features/location/LocationProvider';
import { MapSheet } from '@/features/map/MapSheet';
import { PlaceSheet } from '@/features/map/PlaceSheet';
import { ParkingMap, type ParkingMapHandle } from '@/features/map/ParkingMap';
import { useMapItems, type MapRegion } from '@/features/map/queries';
import { Button, colors, radius, shadows, spacing, Text } from '@/ui';

type Filter = 'ALL' | 'FAV' | 'PUBLIC' | 'PRIVATE';
const BOTH: ParkingKind[] = ['PUBLIC_PARKING', 'PRIVATE_MARKETPLACE_PARKING'];
const FILTERS: { value: Filter; label: string; kinds: ParkingKind[]; favoritesOnly?: boolean }[] = [
  { value: 'ALL', label: 'Alle', kinds: BOTH },
  { value: 'FAV', label: 'Favoriten', kinds: BOTH, favoritesOnly: true },
  { value: 'PUBLIC', label: 'Parkhäuser', kinds: ['PUBLIC_PARKING'] },
  { value: 'PRIVATE', label: 'Private Plätze', kinds: ['PRIVATE_MARKETPLACE_PARKING'] },
];

const CITY_DELTA = 0.06;
const USER_DELTA = 0.025;

export default function MapTab() {
  const insets = useSafeAreaInsets();
  const { permission, coords, request, refresh } = useLocation();
  const mapRef = useRef<ParkingMapHandle>(null);

  const initialRegion = useMemo<MapRegion>(
    () => ({
      latitude: coords?.lat ?? DEFAULT_CENTER.lat,
      longitude: coords?.lng ?? DEFAULT_CENTER.lng,
      latitudeDelta: coords ? USER_DELTA : CITY_DELTA,
      longitudeDelta: coords ? USER_DELTA : CITY_DELTA,
    }),
    // nur beim ersten Rendern
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [region, setRegion] = useState<MapRegion | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [selected, setSelected] = useState<MapItem | null>(null);
  const userMovedMap = useRef(false);
  const centeredOnUser = useRef(!!coords);

  const active = FILTERS.find((f) => f.value === filter)!;
  const { data, isFetching, isError, refetch } = useMapItems(region, active.kinds, !!active.favoritesOnly);

  // Ortssuche: Kamera-Flug zum gesuchten Ort, Ziel-Pin und "Parken bei …"-Liste
  const focus = useLocalSearchParams<{ focusLat?: string; focusLng?: string; focusLabel?: string; focusAt?: string }>();
  const [place, setPlace] = useState<{ lat: number; lng: number; label: string } | null>(null);
  useEffect(() => {
    const lat = Number(focus.focusLat);
    const lng = Number(focus.focusLng);
    if (!focus.focusLat || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    userMovedMap.current = true;
    centeredOnUser.current = true;
    setSelected(null);
    setPlace({ lat, lng, label: focus.focusLabel || 'Gesuchter Ort' });
    const from = region ? { lat: region.latitude, lng: region.longitude } : null;
    const t = setTimeout(() => mapRef.current?.flyTo({ lat, lng }, from), 250);
    return () => clearTimeout(t);
    // nur bei einer neuen Suche (focusAt), nicht bei jeder Kartenbewegung
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.focusLat, focus.focusLng, focus.focusAt]);

  // Sobald der Standort zum ersten Mal bekannt ist: dorthin springen (falls der Nutzer die Karte nicht bewegt hat)
  useEffect(() => {
    if (coords && !centeredOnUser.current && !userMovedMap.current) {
      centeredOnUser.current = true;
      mapRef.current?.animateTo({ latitude: coords.lat, longitude: coords.lng, latitudeDelta: USER_DELTA, longitudeDelta: USER_DELTA });
    }
  }, [coords]);

  const onRegionChange = useCallback((r: MapRegion) => {
    if (region) userMovedMap.current = true;
    setRegion(r);
  }, [region]);

  const onClusterPress = (c: MapCluster) => {
    const delta = Math.max((region?.longitudeDelta ?? 10) / 4, 0.02);
    mapRef.current?.animateTo({ latitude: c.lat, longitude: c.lng, latitudeDelta: delta, longitudeDelta: delta });
  };

  const locateMe = async () => {
    if (permission !== 'granted') {
      await request();
      return;
    }
    const pos = (await refresh()) ?? coords;
    if (pos) {
      mapRef.current?.animateTo({ latitude: pos.lat, longitude: pos.lng, latitudeDelta: USER_DELTA, longitudeDelta: USER_DELTA });
    }
  };

  // Ausgewählten Pin mit aktuellen Daten (z. B. Belegung) synchron halten
  const selectedItem = selected ? (data?.items.find((i) => i.id === selected.id) ?? selected) : null;
  const sheetBottom = spacing.md;

  return (
    <View style={styles.root}>
      <ParkingMap
        ref={mapRef}
        initialRegion={initialRegion}
        items={data?.items ?? []}
        clusters={data?.clusters ?? []}
        selectedId={selectedItem?.id ?? null}
        showsUserLocation={permission === 'granted'}
        topInset={insets.top + 110}
        bottomInset={selectedItem ? 190 : place ? 330 : 0}
        onRegionChange={onRegionChange}
        onSelect={setSelected}
        onClusterPress={onClusterPress}
        onMapPress={() => setSelected(null)}
        destination={place}
      />

      {/* Suche + Filter oben */}
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        <Pressable
          onPress={() => router.push('/search')}
          accessibilityRole="search"
          accessibilityLabel="Wo möchtest du parken?"
          style={[styles.search, shadows.card]}
        >
          <Ionicons name="search" size={18} color={colors.accent} />
          <Text variant="body" tone={place ? 'default' : 'tertiary'} numberOfLines={1} style={{ flex: 1 }}>
            {place ? place.label : 'Wo möchtest du parken?'}
          </Text>
          {place ? (
            <Pressable onPress={() => setPlace(null)} hitSlop={10} accessibilityLabel="Suche zurücksetzen">
              <Ionicons name="close-circle" size={18} color={colors.inkTertiary} />
            </Pressable>
          ) : null}
        </Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map((f) => {
            const isActive = f.value === filter;
            return (
              <Pressable
                key={f.value}
                onPress={() => {
                  setFilter(f.value);
                  setSelected(null);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                style={[styles.chip, shadows.card, isActive && styles.chipActive]}
              >
                {f.favoritesOnly ? (
                  <Ionicons name="heart" size={14} color={isActive ? colors.onPrimary : colors.favorite} />
                ) : null}
                <Text variant="captionStrong" style={{ color: isActive ? colors.onPrimary : colors.ink }}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
          {isFetching ? <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: spacing.xs }} /> : null}
        </ScrollView>
        {filter === 'FAV' && data && data.items.length === 0 && !isFetching ? (
          <View style={[styles.hint, shadows.card]}>
            <Text variant="caption" tone="secondary">
              Keine Favoriten in diesem Kartenausschnitt. Tippe auf das Herz bei einem Parkplatz, um ihn zu speichern.
            </Text>
          </View>
        ) : null}
      </View>

      {/* Standort-Button */}
      <Pressable
        onPress={() => void locateMe()}
        accessibilityRole="button"
        accessibilityLabel="Auf meinen Standort zentrieren"
        style={[styles.fab, shadows.floating, { bottom: (selectedItem ? 200 : place ? 350 : 0) + spacing.lg }]}
      >
        <Ionicons name={permission === 'granted' ? 'locate' : 'locate-outline'} size={22} color={colors.accent} />
      </Pressable>

      {isError ? (
        <Pressable style={[styles.toast, shadows.card]} onPress={() => void refetch()}>
          <Text variant="captionStrong">Parkplätze konnten nicht geladen werden · Erneut versuchen</Text>
        </Pressable>
      ) : null}

      {selectedItem ? (
        <MapSheet item={selectedItem} userCoords={coords} bottomInset={sheetBottom} onClose={() => setSelected(null)} />
      ) : place ? (
        <PlaceSheet
          place={place}
          bottomInset={sheetBottom}
          onClose={() => setPlace(null)}
          onSelect={(item) => {
            setSelected(item);
            mapRef.current?.animateTo({ latitude: item.lat, longitude: item.lng, latitudeDelta: 0.008, longitudeDelta: 0.008 });
          }}
        />
      ) : permission === 'undetermined' || permission === 'denied' ? (
        <View style={[styles.prompt, shadows.floating]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">Parkplätze in deiner Nähe</Text>
            <Text variant="caption" tone="secondary">
              {permission === 'denied'
                ? 'Standort ist deaktiviert. Du kannst ihn in den Einstellungen erlauben.'
                : 'Dein Standort bleibt auf deinem Gerät und wird nicht gespeichert.'}
            </Text>
          </View>
          <Button
            title={permission === 'denied' ? 'Einstellungen' : 'Aktivieren'}
            size="md"
            fullWidth={false}
            onPress={() => void request()}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  top: { position: 'absolute', left: 0, right: 0 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    minHeight: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chips: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: 6 },
  hint: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    minHeight: 38,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prompt: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md + 60,
    bottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    top: 120,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
});
