import { Linking, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { distanceMeters, formatDistance, formatMoney, type FacilityDetail } from '@parking/shared';
import { useLocation } from '@/features/location/LocationProvider';
import { occupancyColor, occupancyLevel, occupancyText, relativeTime } from '@/features/map/format';
import { openInAppRoute } from '@/features/route/open';
import { useFacility } from '@/features/map/queries';
import { useMe } from '@/features/profile/queries';
import { userMessage } from '@/lib/errors';
import { FavoriteButton, RatingInline } from '@/features/social/components';
import { FacilityReviews } from '@/features/social/FacilityReviews';
import { Badge, Button, colors, Divider, ErrorState, radius, Screen, SectionTitle, Skeleton, spacing, Text } from '@/ui';

export default function FacilityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const facility = useFacility(id);

  if (facility.isPending) {
    return (
      <Screen edges={['bottom']} contentStyle={{ gap: spacing.lg, paddingTop: spacing.lg }}>
        <Skeleton height={32} width="70%" />
        <Skeleton height={16} width="50%" />
        <Skeleton height={120} rounded={radius.lg} />
        <Skeleton height={200} rounded={radius.lg} />
      </Screen>
    );
  }
  if (facility.isError) {
    return <ErrorState message={userMessage(facility.error)} onRetry={() => void facility.refetch()} />;
  }
  return <FacilityView f={facility.data} refreshing={facility.isRefetching} onRefresh={() => void facility.refetch()} />;
}

function FacilityView({ f, refreshing, onRefresh }: { f: FacilityDetail; refreshing: boolean; onRefresh: () => void }) {
  const { coords } = useLocation();
  const me = useMe();
  const isAdmin = !!me.data?.roles.includes('ADMIN');
  const level = occupancyLevel(f.occupancy, f.capacity);
  const address = [f.street, [f.postalCode, f.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const distance = coords ? formatDistance(distanceMeters(coords, f)) : null;
  const fillRatio =
    f.capacity && f.occupancy?.isLive && f.occupancy.freeSpaces !== null
      ? Math.min(1, Math.max(0, 1 - f.occupancy.freeSpaces / f.capacity))
      : null;

  return (
    <Screen
      edges={['bottom']}
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        <Button title="Route starten" icon="navigate" onPress={() => openInAppRoute({ lat: f.lat, lng: f.lng, name: f.name, facilityId: f.id })} />
      }
    >
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <FavoriteButton target={{ kind: 'PUBLIC_PARKING', id: f.id }} isFavorite={f.isFavorite} size={24} />
          ),
        }}
      />
      <View style={{ gap: spacing.sm, paddingTop: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <Badge label={f.facilityType === 'LOT' ? 'Parkplatz' : 'Parkhaus'} />
          <Badge label="Öffentlich" tone="primary" />
        </View>
        <Text variant="title">{f.name}</Text>
        <RatingInline rating={f.rating} emptyText="Noch keine Bewertungen" />
        <Text variant="callout" tone="secondary">
          {[address || null, distance ? `${distance} entfernt` : null].filter(Boolean).join(' · ')}
        </Text>
      </View>

      {/* Belegung */}
      <View style={styles.occupancy}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
          <Text variant="display" style={{ color: level === 'unknown' ? colors.inkSecondary : occupancyColor[level] }}>
            {level === 'high' || level === 'low' ? f.occupancy!.freeSpaces : '–'}
          </Text>
          <Text variant="bodyStrong">{level === 'high' || level === 'low' ? 'freie Plätze' : occupancyText(f.occupancy, f.capacity)}</Text>
        </View>
        {fillRatio !== null ? (
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${Math.round(fillRatio * 100)}%`, backgroundColor: occupancyColor[level] }]} />
          </View>
        ) : null}
        <Text variant="caption" tone="secondary">
          {f.occupancy?.isLive
            ? `Live vom Parkleitsystem, aktualisiert ${relativeTime(f.occupancy.observedAt)}`
            : 'Keine aktuelle Belegung verfügbar'}
          {f.capacity ? ` · ${f.capacity} Plätze total` : ''}
        </Text>
      </View>

      <SectionTitle>Informationen</SectionTitle>
      <InfoRow icon="car-outline" label="Kapazität" value={f.capacity ? `${f.capacity} Plätze` : 'Unbekannt'} />
      <Divider inset={38} />
      <InfoRow icon="time-outline" label="Öffnungszeiten" value={f.openingHours ?? 'Siehe Betreiber'} />
      {f.maxHeightCm ? (
        <>
          <Divider inset={38} />
          <InfoRow icon="resize-outline" label="Max. Einfahrtshöhe" value={`${(f.maxHeightCm / 100).toFixed(2)} m`} />
        </>
      ) : null}
      {f.hasEvCharging !== null ? (
        <>
          <Divider inset={38} />
          <InfoRow icon="flash-outline" label="E-Ladestation" value={f.hasEvCharging ? 'Vorhanden' : 'Keine'} />
        </>
      ) : null}

      <SectionTitle>Tarife</SectionTitle>
      {f.tariffs.length ? (
        <>
          {f.tariffs.map((t) => (
            <InfoRow key={t.label} icon="pricetag-outline" label={t.label} value={formatMoney({ amount: t.amount, currency: t.currency })} />
          ))}
          {f.tariffsAsOf ? (
            <Text variant="caption" tone="tertiary" style={{ marginTop: spacing.xs }}>
              Stand vom {f.tariffsAsOf.split('-').reverse().join('.')}
              {f.tariffsSourceUrl ? ' · ' : ''}
              {f.tariffsSourceUrl ? (
                <Text variant="caption" style={{ color: colors.accent }} onPress={() => void Linking.openURL(f.tariffsSourceUrl!)}>
                  Quelle
                </Text>
              ) : null}
              {' · Angaben ohne Gewähr'}
            </Text>
          ) : null}
        </>
      ) : (
        <Text variant="callout" tone="secondary">
          Für dieses Parkhaus haben wir noch keine geprüften Tarife.
        </Text>
      )}
      {isAdmin ? (
        <Button
          title="Tarife bearbeiten (Admin)"
          variant="ghost"
          size="md"
          icon="create-outline"
          style={{ marginTop: spacing.sm }}
          onPress={() => router.push({ pathname: '/admin/tariffs/[id]', params: { id: f.id } })}
        />
      ) : null}
      {f.website ? (
        <Button
          title="Tarife & Infos beim Betreiber"
          variant="secondary"
          size="md"
          icon="open-outline"
          style={{ marginTop: spacing.md }}
          onPress={() => void Linking.openURL(f.website!)}
        />
      ) : null}

      <FacilityReviews
        facilityId={f.id}
        rating={f.rating}
        onWrite={() => router.push({ pathname: '/review/facility/[id]', params: { id: f.id, name: f.name } })}
      />

      <Text variant="caption" tone="tertiary" style={{ marginTop: spacing.xxl }}>
        Quelle: {f.source.attribution ?? f.source.name} · Lizenz {f.source.license}
      </Text>
    </Screen>
  );
}

function InfoRow({ icon, label, value }: { icon: ComponentProps<typeof Ionicons>['name']; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={22} color={colors.ink} />
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="callout" tone="secondary" style={{ maxWidth: '50%', textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  occupancy: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.surfacePressed, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, minHeight: 52 },
});
