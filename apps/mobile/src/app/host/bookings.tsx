import { View } from 'react-native';
import { Stack } from 'expo-router';
import { BookingCard } from '@/features/bookings/BookingCard';
import { useHostBookings } from '@/features/bookings/queries';
import { userMessage } from '@/lib/errors';
import { EmptyState, ErrorState, radius, Screen, SectionTitle, Skeleton, spacing } from '@/ui';

/** Buchungen auf meinen Parkplätzen: offene Anfragen zuerst. */
export default function HostBookings() {
  const q = useHostBookings();
  const now = Date.now();
  const all = q.data ?? [];
  const requests = all.filter((b) => b.status === 'PENDING_APPROVAL');
  const upcoming = all.filter((b) => b.status === 'CONFIRMED' && new Date(b.endAt).getTime() > now).sort((a, b) => a.startAt.localeCompare(b.startAt));
  const past = all.filter((b) => !requests.includes(b) && !upcoming.includes(b));

  return (
    <Screen edges={['bottom']} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Stack.Screen options={{ title: 'Buchungen meiner Plätze' }} />
      {q.isPending ? (
        <Skeleton height={96} rounded={radius.lg} />
      ) : q.isError ? (
        <ErrorState message={userMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState icon="calendar-clear-outline" title="Noch keine Buchungen" message="Sobald jemand deinen Parkplatz bucht, siehst du es hier." />
      ) : (
        <>
          {requests.length ? (
            <>
              <SectionTitle>{`Offene Anfragen (${requests.length})`}</SectionTitle>
              <View style={{ gap: spacing.md }}>
                {requests.map((b) => (
                  <BookingCard key={b.id} b={b} />
                ))}
              </View>
            </>
          ) : null}
          {upcoming.length ? (
            <>
              <SectionTitle>Bevorstehend</SectionTitle>
              <View style={{ gap: spacing.md }}>
                {upcoming.map((b) => (
                  <BookingCard key={b.id} b={b} />
                ))}
              </View>
            </>
          ) : null}
          {past.length ? (
            <>
              <SectionTitle>Vergangen</SectionTitle>
              <View style={{ gap: spacing.md }}>
                {past.map((b) => (
                  <BookingCard key={b.id} b={b} />
                ))}
              </View>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
