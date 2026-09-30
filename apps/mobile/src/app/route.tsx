import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import {
  formatArrival,
  formatDistance,
  formatDuration,
  formatManeuverDistance,
  maneuverText,
} from '@parking/shared';
import { ApiError } from '@parking/api-client';
import { useLocation, type Coordinates } from '@/features/location/LocationProvider';
import { navigation as externalNavigation } from '@/features/map/navigation';
import { CarIcon, ManeuverIcon } from '@/features/route/icons';
import { RouteMap, type RouteMapHandle } from '@/features/route/RouteMap';
import { SIMULATION_AVAILABLE, useRouteNavigation } from '@/features/route/useRouteNavigation';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { Button, colors, radius, shadows, spacing, Text } from '@/ui';

const externalLabel = Platform.OS === 'ios' ? 'In Apple Maps öffnen' : 'In Google Maps öffnen';

/**
 * Route in der App: Übersicht (Linie, Zeit, Distanz, Ankunft) und Navigationsmodus
 * mit Auto-Icon, mitlaufender Kamera, Manöver-Banner, Ansagen und Neuberechnung.
 */
export default function RouteScreen() {
  const params = useLocalSearchParams<{ lat: string; lng: string; name?: string; facilityId?: string }>();
  const destination = useMemo(() => ({ lat: Number(params.lat), lng: Number(params.lng) }), [params.lat, params.lng]);
  const name = params.name || 'Ziel';
  const insets = useSafeAreaInsets();
  const { coords, permission, request, refresh } = useLocation();
  const mapRef = useRef<RouteMapHandle>(null);
  const [origin, setOrigin] = useState<Coordinates | null>(null);
  const [following, setFollowing] = useState(true);
  const nav = useRouteNavigation(destination);

  // Start einmalig festhalten (frische Position, sonst die letzte bekannte)
  useEffect(() => {
    if (origin || permission !== 'granted') return;
    let cancelled = false;
    void refresh().then((fresh) => {
      if (!cancelled) setOrigin(fresh ?? coords);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission, origin]);
  useEffect(() => {
    if (!origin && coords && permission === 'granted') setOrigin(coords);
  }, [coords, origin, permission]);

  const query = useQuery({
    queryKey: ['route', origin?.lat, origin?.lng, destination.lat, destination.lng],
    queryFn: ({ signal }) => api.route.get(origin!, destination, signal),
    enabled: Boolean(origin),
    staleTime: 5 * 60_000,
    gcTime: 0,
    retry: false,
  });

  useEffect(() => {
    if (query.data) nav.setInitialRoute(query.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  const route = nav.route;
  const s = nav.snapshot;
  const navigating = nav.phase === 'navigating';

  // Linie: im Navigationsmodus nur noch der Rest ab der aktuellen Position
  const line = useMemo<[number, number][]>(() => {
    if (!route) return [];
    if (!navigating || !s) return route.coordinates;
    return [[s.snapped.lat, s.snapped.lng], ...route.coordinates.slice(s.segmentIndex + 1)];
  }, [route, navigating, s]);

  const car = navigating && s ? { lat: s.snapped.lat, lng: s.snapped.lng, bearing: s.bearing } : null;

  // Kamera folgt dem Auto
  useEffect(() => {
    if (navigating && following && s) mapRef.current?.follow(s.snapped, s.bearing, nav.lastFix?.speed);
  }, [navigating, following, s, nav.lastFix]);

  // Zurück in die Übersicht: ganze Route zeigen
  useEffect(() => {
    if (nav.phase !== 'navigating' && route) {
      const t = setTimeout(() => mapRef.current?.fit(), 150);
      return () => clearTimeout(t);
    }
  }, [nav.phase, route]);

  const openExternal = () => void externalNavigation.openRoute({ ...destination, label: name });

  const topInset = navigating ? insets.top + 150 : insets.top + 56;
  const bottomInset = navigating ? insets.bottom + 110 : insets.bottom + 250;

  const errorReason =
    query.error instanceof ApiError ? (query.error.details as { reason?: string } | undefined)?.reason : undefined;

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: !navigating }} />

      {route ? (
        <RouteMap
          ref={mapRef}
          line={line}
          destination={destination}
          car={car}
          navigating={navigating}
          following={following}
          topInset={topInset}
          bottomInset={bottomInset}
          onUserInteract={() => setFollowing(false)}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface }]} />
      )}

      {/* ── Navigationsmodus ─────────────────────────────── */}
      {navigating ? (
        <>
          <View style={[styles.banner, shadows.floating, { top: insets.top + spacing.sm }]}>
            {s ? (
              <>
                <ManeuverIcon type={s.maneuver.type} size={44} />
                <View style={{ flex: 1 }}>
                  <Text variant="title" style={styles.onNavy}>
                    {s.maneuver.type === 'ARRIVE' && s.distanceToManeuver < 40 ? 'Jetzt' : formatManeuverDistance(s.distanceToManeuver)}
                  </Text>
                  <Text variant="headline" style={styles.onNavy} numberOfLines={2}>
                    {maneuverText(s.maneuver)}
                  </Text>
                  {s.maneuver.streetName ? (
                    <Text variant="callout" style={styles.onNavySoft} numberOfLines={1}>
                      {s.maneuver.streetName}
                    </Text>
                  ) : null}
                </View>
              </>
            ) : (
              <>
                <ActivityIndicator color={colors.onPrimary} />
                <Text variant="headline" style={styles.onNavy}>
                  Suche GPS-Signal …
                </Text>
              </>
            )}
          </View>
          {nav.rerouting ? (
            <View style={[styles.pill, { top: insets.top + 150 }]}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text variant="captionStrong">Route wird neu berechnet …</Text>
            </View>
          ) : null}

          <View style={[styles.mapButtons, { bottom: insets.bottom + 110 }]} pointerEvents="box-none">
            <Pressable
              onPress={() => {
                setFollowing(false);
                mapRef.current?.overview();
              }}
              style={[styles.mapButton, shadows.floating]}
              accessibilityRole="button"
              accessibilityLabel="Ganze Route anzeigen"
            >
              <Ionicons name="map-outline" size={20} color={colors.ink} />
            </Pressable>
            {!following ? (
              <Pressable
                onPress={() => setFollowing(true)}
                style={[styles.recenter, shadows.floating]}
                accessibilityRole="button"
              >
                <Ionicons name="navigate" size={18} color={colors.accent} />
                <Text variant="bodyStrong" style={{ color: colors.accent }}>
                  Zentrieren
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={[styles.navBar, shadows.floating, { paddingBottom: insets.bottom + spacing.md }]}>
            <Pressable
              onPress={nav.toggleMute}
              style={styles.roundButton}
              accessibilityRole="button"
              accessibilityLabel={nav.muted ? 'Ansagen einschalten' : 'Ansagen ausschalten'}
            >
              <Ionicons name={nav.muted ? 'volume-mute' : 'volume-high'} size={22} color={colors.ink} />
            </Pressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text variant="title" style={{ color: colors.success }}>
                {formatDuration(s?.remainingSeconds ?? route?.durationSeconds ?? 0)}
              </Text>
              <Text variant="caption" tone="secondary">
                {formatDistance(s?.remainingMeters ?? route?.distanceMeters ?? 0)} · Ankunft{' '}
                {formatArrival(s?.remainingSeconds ?? route?.durationSeconds ?? 0)}
                {nav.simulating ? ' · Simulation' : ''}
              </Text>
            </View>
            <Pressable onPress={nav.stop} style={styles.endButton} accessibilityRole="button">
              <Text variant="bodyStrong" style={{ color: colors.onPrimary }}>
                Beenden
              </Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {/* ── Übersicht / Ankunft ──────────────────────────── */}
      {!navigating ? (
        <>
          <Pressable
            onPress={() => router.back()}
            style={[styles.back, shadows.floating, { top: insets.top + spacing.sm }]}
            accessibilityRole="button"
            accessibilityLabel="Zurück"
          >
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>

          <View style={[styles.sheet, shadows.floating, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {nav.phase === 'arrived' ? 'Angekommen' : 'Route zu'}
            </Text>
            <Text variant="headline" numberOfLines={1}>
              {name}
            </Text>

            {nav.phase === 'arrived' ? (
              <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                <View style={styles.arrived}>
                  <Ionicons name="checkmark-circle" size={28} color={colors.success} />
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    Du bist angekommen
                  </Text>
                </View>
                {params.facilityId ? (
                  <Button
                    title="Parkhaus-Details"
                    icon="information-circle-outline"
                    onPress={() => router.replace({ pathname: '/facility/[id]', params: { id: params.facilityId! } })}
                  />
                ) : null}
                <Button title="Fertig" variant="secondary" onPress={() => router.back()} />
              </View>
            ) : permission !== 'granted' && permission !== 'unknown' ? (
              <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                <Text variant="callout" tone="secondary">
                  Für die Route brauchen wir deinen Standort. Er bleibt auf deinem Gerät und wird nicht gespeichert.
                </Text>
                <Button title={permission === 'denied' ? 'Einstellungen öffnen' : 'Standort erlauben'} icon="location" onPress={() => void request()} />
                <Button title={externalLabel} variant="ghost" onPress={openExternal} />
              </View>
            ) : query.isError ? (
              <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                <Text variant="callout" tone={errorReason === 'ROUTING_NOT_CONFIGURED' ? 'secondary' : 'danger'}>
                  {userMessage(query.error)}
                </Text>
                <Button title={externalLabel} icon="open-outline" onPress={openExternal} />
                {errorReason !== 'ROUTING_NOT_CONFIGURED' ? (
                  <Button title="Erneut versuchen" variant="secondary" onPress={() => void query.refetch()} />
                ) : null}
              </View>
            ) : !route ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.accent} />
                <Text variant="callout" tone="secondary">
                  Route wird berechnet …
                </Text>
              </View>
            ) : (
              <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                <View style={styles.summary}>
                  <Text variant="display" style={{ color: colors.success }}>
                    {formatDuration(route.durationSeconds)}
                  </Text>
                  <Text variant="callout" tone="secondary">
                    {formatDistance(route.distanceMeters)} · Ankunft {formatArrival(route.durationSeconds)}
                  </Text>
                </View>
                <Button
                  title="Losfahren"
                  icon="navigate"
                  onPress={() => {
                    setFollowing(true);
                    void nav.start();
                  }}
                />
                <View style={styles.row}>
                  <Pressable onPress={openExternal} hitSlop={8} accessibilityRole="link">
                    <Text variant="captionStrong" style={{ color: colors.accent }}>
                      {externalLabel}
                    </Text>
                  </Pressable>
                  {SIMULATION_AVAILABLE ? (
                    <Pressable
                      onPress={() => {
                        setFollowing(true);
                        void nav.start({ simulate: true });
                      }}
                      hitSlop={8}
                      accessibilityRole="button"
                      style={styles.simButton}
                    >
                      <CarIconSmall />
                      <Text variant="captionStrong" tone="secondary">
                        Fahrt simulieren
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text variant="caption" tone="tertiary" numberOfLines={2}>
                  {route.attribution}
                </Text>
              </View>
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}

function CarIconSmall() {
  return (
    <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', transform: [{ scale: 0.4 }] }}>
      <CarIcon rotation={90} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  onNavy: { color: colors.onPrimary },
  onNavySoft: { color: 'rgba(255,255,255,0.8)' },
  banner: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    minHeight: 96,
  },
  pill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  mapButtons: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mapButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  navBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  roundButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endButton: {
    backgroundColor: colors.danger,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  back: {
    position: 'absolute',
    left: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  summary: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  simButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  arrived: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
});
