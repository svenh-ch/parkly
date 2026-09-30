import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Booking } from '@parking/shared';
import { BookingCard } from '@/features/bookings/BookingCard';
import { TIER } from '@/features/bookings/format';
import { useBookings, useLoyalty } from '@/features/bookings/queries';
import { userMessage } from '@/lib/errors';
import { EmptyState, ErrorState, radius, Screen, ScreenHeader, SegmentedControl, Skeleton, spacing, Text } from '@/ui';

type Scope = 'upcoming' | 'past';

const isUpcoming = (b: Booking, now: number) => ['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED'].includes(b.status) && new Date(b.endAt).getTime() > now;

export default function Bookings() {
  const [scope, setScope] = useState<Scope>('upcoming');
  const list = useBookings();
  const loyalty = useLoyalty();
  const now = Date.now();
  const items = (list.data ?? []).filter((b) => (scope === 'upcoming' ? isUpcoming(b, now) : !isUpcoming(b, now)));
  if (scope === 'upcoming') items.sort((a, b) => a.startAt.localeCompare(b.startAt));
  const tier = loyalty.data ? TIER[loyalty.data.tier] : null;

  return (
    <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      <ScreenHeader
        title="Buchungen"
        right={
          tier ? (
            <Pressable onPress={() => router.push('/loyalty')} style={[styles.tier, { backgroundColor: tier.soft }]} accessibilityLabel={`Status ${tier.label}`}>
              <Ionicons name={tier.icon} size={14} color={tier.color} />
              <Text variant="captionStrong" style={{ color: tier.color }}>
                {tier.label}
              </Text>
            </Pressable>
          ) : undefined
        }
      />
      <SegmentedControl
        value={scope}
        onChange={setScope}
        options={[
          { value: 'upcoming', label: 'Bevorstehend' },
          { value: 'past', label: 'Vergangen' },
        ]}
      />
      <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
        {list.isPending ? (
          <>
            <Skeleton height={96} rounded={radius.lg} />
            <Skeleton height={96} rounded={radius.lg} />
          </>
        ) : list.isError ? (
          <ErrorState message={userMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          scope === 'upcoming' ? (
            <EmptyState
              icon="calendar-clear-outline"
              title="Keine bevorstehenden Buchungen"
              message="Wenn du einen Parkplatz buchst, findest du ihn hier, inklusive Route und Zugangsinfos."
              action={{ label: 'Parkplatz finden', onPress: () => router.push('/map') }}
            />
          ) : (
            <EmptyState icon="time-outline" title="Noch keine vergangenen Buchungen" />
          )
        ) : (
          items.map((b) => <BookingCard key={b.id} b={b} />)
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tier: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
});
