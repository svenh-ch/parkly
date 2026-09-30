import { View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { NearbyCard } from '@/features/map/NearbyCard';
import { useNearby } from '@/features/map/queries';
import { userMessage } from '@/lib/errors';
import { Button, EmptyState, ErrorState, radius, Screen, ScreenHeader, Skeleton, spacing } from '@/ui';

/** Ergebnis einer Ortssuche: Parkplätze rund um den gewählten Ort, nach Entfernung. */
export default function PlaceResults() {
  const params = useLocalSearchParams<{ lat: string; lng: string; label?: string }>();
  const lat = Number(params.lat);
  const lng = Number(params.lng);
  const valid = Number.isFinite(lat) && Number.isFinite(lng);
  const nearby = useNearby(valid ? { lat, lng } : { lat: 0, lng: 0 });

  return (
    <Screen
      edges={['bottom']}
      onRefresh={() => void nearby.refetch()}
      refreshing={nearby.isRefetching}
      footer={
        valid ? (
          <Button
            title="Auf der Karte anzeigen"
            icon="map-outline"
            onPress={() =>
              router.navigate({ pathname: '/map', params: { focusLat: String(lat), focusLng: String(lng), focusLabel: params.label ?? '' } })
            }
          />
        ) : undefined
      }
    >
      <Stack.Screen options={{ title: '' }} />
      <ScreenHeader title="Parken bei" subtitle={params.label ?? 'gewähltem Ort'} />
      <View style={{ gap: spacing.md }}>
        {!valid ? (
          <EmptyState icon="alert-circle-outline" title="Ort unbekannt" />
        ) : nearby.isPending ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} height={76} rounded={radius.lg} />)
        ) : nearby.isError ? (
          <ErrorState message={userMessage(nearby.error)} onRetry={() => void nearby.refetch()} />
        ) : nearby.data.length === 0 ? (
          <EmptyState
            icon="car-outline"
            title="Keine Parkplätze gefunden"
            message="In dieser Gegend haben wir noch keine Parkhäuser oder privaten Plätze."
          />
        ) : (
          nearby.data.map((item) => <NearbyCard key={item.id} item={item} />)
        )}
      </View>
    </Screen>
  );
}
