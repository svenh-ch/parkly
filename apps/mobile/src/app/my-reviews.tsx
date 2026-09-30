import { View } from 'react-native';
import { router } from 'expo-router';
import { Stars } from '@/features/social/components';
import { useMyReviews } from '@/features/social/queries';
import { userMessage } from '@/lib/errors';
import { Badge, Card, EmptyState, ErrorState, radius, Screen, Skeleton, spacing, Text } from '@/ui';

const dateFmt = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'long', year: 'numeric' });

export default function MyReviews() {
  const reviews = useMyReviews();
  return (
    <Screen edges={['bottom']} onRefresh={() => void reviews.refetch()} refreshing={reviews.isRefetching}>
      <View style={{ gap: spacing.md, paddingTop: spacing.lg }}>
        {reviews.isPending ? (
          [0, 1].map((i) => <Skeleton key={i} height={96} rounded={radius.lg} />)
        ) : reviews.isError ? (
          <ErrorState message={userMessage(reviews.error)} onRetry={() => void reviews.refetch()} />
        ) : reviews.data.length === 0 ? (
          <EmptyState
            icon="star-outline"
            title="Noch keine Bewertungen"
            message="Bewerte Parkhäuser auf ihrer Detailseite und hilf anderen bei der Wahl."
          />
        ) : (
          reviews.data.map((r) => (
            <Card
              key={r.id}
              style={{ gap: spacing.sm }}
              onPress={
                r.target.kind === 'PUBLIC_PARKING'
                  ? () => router.push({ pathname: '/facility/[id]', params: { id: r.target.id } })
                  : undefined
              }
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                  {r.target.name}
                </Text>
                {r.status === 'HIDDEN' ? <Badge label="Ausgeblendet" tone="warning" /> : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Stars value={r.rating} />
                <Text variant="caption" tone="tertiary">
                  {dateFmt.format(new Date(r.createdAt))}
                </Text>
              </View>
              {r.comment ? (
                <Text variant="callout" tone="secondary" numberOfLines={3}>
                  {r.comment}
                </Text>
              ) : null}
            </Card>
          ))
        )}
      </View>
    </Screen>
  );
}
