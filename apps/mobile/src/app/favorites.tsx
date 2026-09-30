import { View } from 'react-native';
import { router } from 'expo-router';
import { useLocation } from '@/features/location/LocationProvider';
import { NearbyCard } from '@/features/map/NearbyCard';
import { useFavorites } from '@/features/social/queries';
import { userMessage } from '@/lib/errors';
import { EmptyState, ErrorState, radius, Screen, Skeleton, spacing } from '@/ui';

export default function Favorites() {
  const { coords } = useLocation();
  const favorites = useFavorites(coords);

  return (
    <Screen edges={['bottom']} onRefresh={() => void favorites.refetch()} refreshing={favorites.isRefetching}>
      <View style={{ gap: spacing.md, paddingTop: spacing.lg }}>
        {favorites.isPending ? (
          [0, 1, 2].map((i) => <Skeleton key={i} height={76} rounded={radius.lg} />)
        ) : favorites.isError ? (
          <ErrorState message={userMessage(favorites.error)} onRetry={() => void favorites.refetch()} />
        ) : favorites.data.length === 0 ? (
          <EmptyState
            icon="heart-outline"
            title="Noch keine Favoriten"
            message="Tippe bei einem Parkhaus oder Parkplatz auf das Herz. Deine Favoriten siehst du dann hier und mit Herz auf der Karte."
            action={{ label: 'Zur Karte', onPress: () => router.push('/map') }}
          />
        ) : (
          favorites.data.map((item) => (
            <NearbyCard key={item.id} item={item} />
          ))
        )}
      </View>
    </Screen>
  );
}
