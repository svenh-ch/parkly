import { useState } from 'react';
import { Dimensions, Image, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { distanceMeters, formatDistance, type SpotDetail } from '@parking/shared';
import { ACCESS_LABEL, AMENITY_LABEL, CANCELLATION_LABEL, chf, EV_LABEL, hhmm, IMAGE_KIND_LABEL, minutesLabel, SPOT_TYPE_LABEL, VEHICLE_LABEL, WEEKDAYS } from '@/features/host/labels';
import { useLocation } from '@/features/location/LocationProvider';
import { openInAppRoute } from '@/features/route/open';
import { FavoriteButton, RatingInline } from '@/features/social/components';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { mediaUrl } from '@/lib/media';
import { Badge, Banner, Button, colors, Divider, ErrorState, radius, Screen, SectionTitle, Skeleton, spacing, Text } from '@/ui';

/** Öffentliche Detailseite eines privaten Parkplatzes (ohne genaue Adresse). */
export default function SpotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['spot', id], queryFn: () => api.spots.detail(id), enabled: !!id, staleTime: 60_000 });

  if (q.isPending) {
    return (
      <Screen edges={['bottom']} padded={false}>
        <Skeleton height={260} rounded={0} />
        <View style={{ padding: spacing.xl, gap: spacing.md }}>
          <Skeleton height={28} width="70%" />
          <Skeleton height={16} width="40%" />
        </View>
      </Screen>
    );
  }
  if (q.isError) return <ErrorState message={userMessage(q.error)} onRetry={() => void q.refetch()} />;
  return <SpotView s={q.data} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />;
}

function Gallery({ s }: { s: SpotDetail }) {
  const width = Dimensions.get('window').width;
  const [index, setIndex] = useState(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  if (!s.images.length) {
    return (
      <View style={[styles.photo, { width, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }]}>
        <Ionicons name="image-outline" size={40} color={colors.inkTertiary} />
      </View>
    );
  }
  return (
    <View>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} onScroll={onScroll} scrollEventThrottle={64}>
        {s.images.map((img) => (
          <Image key={img.id} source={{ uri: img.url ? mediaUrl(img.url) : undefined }} style={[styles.photo, { width }]} accessibilityLabel={IMAGE_KIND_LABEL[img.kind]} />
        ))}
      </ScrollView>
      <View style={styles.counter}>
        <Text variant="captionStrong" style={{ color: colors.onPrimary }}>
          {index + 1} / {s.images.length} · {IMAGE_KIND_LABEL[s.images[index]?.kind ?? 'OTHER']}
        </Text>
      </View>
    </View>
  );
}

function Fact({ icon, children }: { icon: React.ComponentProps<typeof Ionicons>['name']; children: string }) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={18} color={colors.accent} />
      <Text variant="callout" style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}

function availabilityText(s: SpotDetail): string[] {
  if (s.access24h) return ['Immer verfügbar (24/7)'];
  return WEEKDAYS.map((d, i) => {
    const rules = s.availability.filter((r) => r.weekday === i + 1);
    return rules.length ? `${d}  ${rules.map((r) => `${hhmm(r.startMinute)}–${r.endMinute === 1440 ? '24:00' : hhmm(r.endMinute)}`).join(', ')}` : `${d}  –`;
  });
}

function SpotView({ s, refreshing, onRefresh }: { s: SpotDetail; refreshing: boolean; onRefresh: () => void }) {
  const { coords } = useLocation();
  const distance = coords ? formatDistance(distanceMeters(coords, s)) : null;
  const prices = [
    s.prices.hourly && ['pro Stunde', s.prices.hourly],
    s.prices.daily && ['pro Tag', s.prices.daily],
    s.prices.weekly && ['pro Woche', s.prices.weekly],
    s.prices.monthly && ['pro Monat', s.prices.monthly],
  ].filter(Boolean) as [string, number][];
  const dims = [s.maxLengthCm && `L ${s.maxLengthCm} cm`, s.maxWidthCm && `B ${s.maxWidthCm} cm`, s.maxHeightCm && `H ${s.maxHeightCm} cm`].filter(Boolean);

  return (
    <Screen
      edges={['bottom']}
      padded={false}
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <Button title="Route" icon="navigate" variant="secondary" fullWidth={false} style={{ flex: 1 }} onPress={() => openInAppRoute({ lat: s.lat, lng: s.lng, name: s.title })} />
          <Button
            title={s.isOwn ? 'Bearbeiten' : 'Zeit wählen'}
            style={{ flex: 2 }}
            onPress={() => (s.isOwn ? router.push({ pathname: '/host/spot/[id]', params: { id: s.id } }) : router.push({ pathname: '/book/[spotId]', params: { spotId: s.id } }))}
          />
        </View>
      }
    >
      <Stack.Screen
        options={{
          title: '',
          headerTransparent: false,
          headerRight: () => (s.isOwn ? null : <FavoriteButton target={{ kind: 'PRIVATE_MARKETPLACE_PARKING', id: s.id }} isFavorite={s.isFavorite} size={24} />),
        }}
      />
      <Gallery s={s} />
      <View style={styles.body}>
        {s.isOwn ? <Banner tone="info">Das ist dein Inserat. So sehen es Mieter.</Banner> : null}
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Badge label={SPOT_TYPE_LABEL[s.spotType]} />
          <Badge label="Privat" tone="primary" />
          {s.hasEvCharging ? <Badge label="E-Laden" /> : null}
        </View>
        <Text variant="title">{s.title}</Text>
        <RatingInline rating={s.rating} emptyText="Noch keine Bewertungen" />
        <Text variant="callout" tone="secondary">
          {[s.area, distance ? `ca. ${distance} entfernt` : null].filter(Boolean).join(' · ')}
        </Text>
        <Text variant="caption" tone="tertiary">
          Die genaue Adresse und die Zugangsinfos erhältst du nach der Buchung.
        </Text>

        <View style={styles.prices}>
          {prices.map(([label, amount]) => (
            <View key={label} style={styles.price}>
              <Text variant="headline">CHF {chf(amount)}</Text>
              <Text variant="caption" tone="secondary">
                {label}
              </Text>
            </View>
          ))}
        </View>

        {s.description ? (
          <>
            <SectionTitle>Beschreibung</SectionTitle>
            <Text variant="body">{s.description}</Text>
          </>
        ) : null}

        <SectionTitle>Auf einen Blick</SectionTitle>
        <View style={{ gap: spacing.sm }}>
          <Fact icon="car-outline">{s.vehicleTypes.map((v) => VEHICLE_LABEL[v]).join(', ')}</Fact>
          {dims.length ? <Fact icon="resize-outline">{`Maximal ${dims.join(' · ')}`}</Fact> : null}
          <Fact icon="key-outline">{`Zugang: ${ACCESS_LABEL[s.accessMethod]}`}</Fact>
          {s.floor ? <Fact icon="layers-outline">{`Stockwerk ${s.floor}`}</Fact> : null}
          {s.isCovered ? <Fact icon="umbrella-outline">Überdacht</Fact> : null}
          {s.hasEvCharging ? (
            <Fact icon="flash-outline">{`Laden: ${s.evConnector ? EV_LABEL[s.evConnector] : 'Ladestation'}${s.evPowerKw ? `, ${s.evPowerKw} kW` : ''}`}</Fact>
          ) : null}
          {s.amenities.map((a) => (
            <Fact key={a} icon="checkmark-circle-outline">
              {AMENITY_LABEL[a]}
            </Fact>
          ))}
        </View>

        <SectionTitle>Verfügbarkeit</SectionTitle>
        <View style={{ gap: 2 }}>
          {availabilityText(s).map((line) => (
            <Text key={line} variant="callout" style={{ fontVariant: ['tabular-nums'] }}>
              {line}
            </Text>
          ))}
        </View>

        <SectionTitle>Buchungsregeln</SectionTitle>
        <View style={{ gap: spacing.sm }}>
          <Fact icon="time-outline">{`Mindestens ${minutesLabel(s.minDurationMinutes)}, höchstens ${minutesLabel(s.maxDurationMinutes)}`}</Fact>
          <Fact icon="hourglass-outline">{s.leadTimeMinutes ? `Buchen bis ${minutesLabel(s.leadTimeMinutes)} vor Beginn` : 'Kurzfristig buchbar'}</Fact>
          <Fact icon={s.instantBook ? 'flash-outline' : 'chatbubble-outline'}>{s.instantBook ? 'Sofort buchbar' : 'Buchung auf Anfrage'}</Fact>
          <Fact icon="refresh-outline">{`${CANCELLATION_LABEL[s.cancellationPolicy].title}: ${CANCELLATION_LABEL[s.cancellationPolicy].text}`}</Fact>
          {s.rules ? <Fact icon="document-text-outline">{s.rules}</Fact> : null}
        </View>

        <Divider />
        <Text variant="caption" tone="tertiary">
          Vermietet von {s.host.firstName ?? 'einem Parkly-Mitglied'}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: { height: 260 },
  counter: { position: 'absolute', right: spacing.md, bottom: spacing.md, backgroundColor: 'rgba(1,24,74,0.8)', borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  body: { padding: spacing.xl, gap: spacing.sm },
  prices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
  price: { flexGrow: 1, minWidth: '40%', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  fact: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
