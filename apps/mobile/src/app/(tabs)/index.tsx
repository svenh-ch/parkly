import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { APP_NAME } from '@/config/app';
import { DEFAULT_CENTER, useLocation } from '@/features/location/LocationProvider';
import { NearbyCard } from '@/features/map/NearbyCard';
import { useNearby } from '@/features/map/queries';
import { useMe } from '@/features/profile/queries';
import { useFavorites } from '@/features/social/queries';
import { occupancyText } from '@/features/map/format';
import { userMessage } from '@/lib/errors';
import {
  Button,
  colors,
  ErrorState,
  radius,
  Screen,
  SectionTitle,
  shadows,
  Skeleton,
  spacing,
  Text,
} from '@/ui';

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 11) return 'Guten Morgen';
  if (h < 18) return 'Hallo';
  return 'Guten Abend';
}

export default function Home() {
  const me = useMe();
  const { coords, permission, request } = useLocation();
  const center = coords ?? DEFAULT_CENTER;
  const nearby = useNearby(center);
  const favorites = useFavorites(coords);

  // "In deiner Nähe" nur, wenn der nächste Parkplatz wirklich nah ist; sonst "Nächste Parkhäuser"
  const firstDistance = nearby.data?.[0]?.distanceMeters ?? 0;
  const sectionTitle = !coords
    ? 'Beliebte Parkhäuser in Zürich'
    : firstDistance > 10_000
      ? 'Nächste Parkhäuser'
      : 'In deiner Nähe';

  return (
    <Screen
      onRefresh={() => {
        void me.refetch();
        void nearby.refetch();
        void favorites.refetch();
      }}
      refreshing={me.isRefetching || nearby.isRefetching}
    >
      <View style={styles.brand}>
        <Image source={require('@/assets/images/logo-mark.png')} style={styles.logo} accessibilityIgnoresInvertColors />
        <Text variant="headline" style={{ color: colors.primary, fontWeight: '700' }}>
          {APP_NAME}
        </Text>
      </View>

      <View style={styles.header}>
        {me.isPending ? (
          <Skeleton width={200} height={30} />
        ) : (
          <Text variant="title">
            {greeting()}
            {me.data?.firstName ? `, ${me.data.firstName}` : ''}
          </Text>
        )}
      </View>

      <Pressable
        accessibilityRole="search"
        accessibilityLabel="Wo möchtest du parken?"
        onPress={() => router.push('/search')}
        style={({ pressed }) => [styles.search, shadows.floating, pressed && { transform: [{ scale: 0.99 }] }]}
      >
        <View style={styles.searchIcon}>
          <Ionicons name="search" size={18} color={colors.onPrimary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">Wo möchtest du parken?</Text>
          <Text variant="caption" tone="secondary">
            Ort, Adresse, Geschäft oder Parkhaus
          </Text>
        </View>
      </Pressable>

      {favorites.data && favorites.data.length > 0 ? (
        <>
          <SectionTitle action={{ label: 'Alle', onPress: () => router.push('/favorites') }}>Deine Favoriten</SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingHorizontal: spacing.xl }} style={styles.bleed}>
            {favorites.data.map((f) => (
              <Pressable
                key={f.id}
                style={({ pressed }) => [styles.favCard, shadows.card, pressed && { transform: [{ scale: 0.98 }] }]}
                onPress={() =>
                  f.kind === 'PUBLIC_PARKING'
                    ? router.push({ pathname: '/facility/[id]', params: { id: f.id } })
                    : router.push({ pathname: '/spot/[id]', params: { id: f.id } })
                }
              >
                <View style={styles.favBadge}>
                  <Ionicons name="heart" size={14} color={colors.onPrimary} />
                </View>
                <Text variant="bodyStrong" numberOfLines={2}>
                  {f.name}
                </Text>
                <Text variant="caption" tone="secondary">
                  {f.kind === 'PUBLIC_PARKING' ? occupancyText(f.occupancy, f.capacity) : 'Privater Parkplatz'}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}

      <SectionTitle action={{ label: 'Karte', onPress: () => router.push('/map') }}>{sectionTitle}</SectionTitle>

      {!coords && permission !== 'unknown' ? (
        <View style={styles.locationHint}>
          <Ionicons name="location" size={20} color={colors.accent} />
          <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
            {permission === 'denied'
              ? 'Standort ist aus. Wir zeigen Parkhäuser rund um Zürich HB.'
              : 'Aktiviere den Standort für Parkplätze in deiner Nähe.'}
          </Text>
          <Button
            title={permission === 'denied' ? 'Einstellungen' : 'Aktivieren'}
            variant="secondary"
            size="md"
            fullWidth={false}
            onPress={() => void request()}
          />
        </View>
      ) : null}

      <View style={{ gap: spacing.md }}>
        {nearby.isPending ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} height={76} rounded={radius.lg} />)
        ) : nearby.isError ? (
          <ErrorState message={userMessage(nearby.error)} onRetry={() => void nearby.refetch()} />
        ) : (
          nearby.data.map((item) => <NearbyCard key={item.id} item={item} />)
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md },
  logo: { width: 18, height: 26, resizeMode: 'contain' },
  header: { paddingTop: spacing.md, paddingBottom: spacing.xl, minHeight: 56, justifyContent: 'flex-end' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xl,
    minHeight: 62,
  },
  searchIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bleed: { marginHorizontal: -spacing.xl },
  favCard: {
    width: 160,
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: spacing.xs,
  },
  favBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.favorite,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  locationHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    marginBottom: spacing.md,
  },
});
