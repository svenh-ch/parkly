import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { RatingSummary, Review } from '@parking/shared';
import { userMessage } from '@/lib/errors';
import { Avatar, Button, colors, Divider, radius, SectionTitle, Skeleton, spacing, Text } from '@/ui';
import { Stars } from './components';
import { useFacilityReviews, useReportReview } from './queries';

const REASONS = [
  { value: 'OFFENSIVE', label: 'Beleidigend oder unangemessen' },
  { value: 'SPAM', label: 'Spam oder Werbung' },
  { value: 'FALSE_INFORMATION', label: 'Falsche Angaben' },
  { value: 'PERSONAL_DATA', label: 'Enthält persönliche Daten' },
  { value: 'OTHER', label: 'Anderer Grund' },
] as const;

const dateFmt = new Intl.DateTimeFormat('de-CH', { month: 'long', year: 'numeric' });

/** Bewertungsbereich einer Parkhaus-Detailseite. */
export function FacilityReviews({
  facilityId,
  rating,
  onWrite,
}: {
  facilityId: string;
  rating: RatingSummary;
  onWrite: () => void;
}) {
  const reviews = useFacilityReviews(facilityId);
  const report = useReportReview();
  const mine = reviews.data?.pages[0]?.mine ?? null;
  const items = reviews.data?.pages.flatMap((p) => p.items).filter((r) => !r.isMine) ?? [];

  const askReport = (review: Review) => {
    const send = (reason: (typeof REASONS)[number]['value']) =>
      report.mutate(
        { reviewId: review.id, input: { reason } },
        {
          onSuccess: () => Alert.alert('Danke für deine Meldung', 'Wir prüfen die Bewertung.'),
          onError: (e) => Alert.alert('Meldung fehlgeschlagen', userMessage(e)),
        },
      );
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Bewertung melden', options: [...REASONS.map((r) => r.label), 'Abbrechen'], cancelButtonIndex: REASONS.length },
        (i) => i < REASONS.length && send(REASONS[i]!.value),
      );
    } else {
      Alert.alert('Bewertung melden', 'Warum meldest du diese Bewertung?', [
        ...REASONS.slice(0, 2).map((r) => ({ text: r.label, onPress: () => send(r.value) })),
        { text: 'Abbrechen', style: 'cancel' as const },
      ]);
    }
  };

  return (
    <View>
      <SectionTitle>Bewertungen</SectionTitle>
      <View style={styles.summary}>
        <Text variant="display">{rating.avg !== null ? rating.avg.toFixed(1) : '–'}</Text>
        <View style={{ gap: 4 }}>
          <Stars value={rating.avg ?? 0} size={16} />
          <Text variant="caption" tone="secondary">
            {rating.count === 0 ? 'Noch keine Bewertungen' : `${rating.count} ${rating.count === 1 ? 'Bewertung' : 'Bewertungen'}`}
          </Text>
        </View>
      </View>

      {mine ? (
        <View style={[styles.review, styles.mine]}>
          <View style={styles.reviewHead}>
            <Text variant="captionStrong">Deine Bewertung</Text>
            <Stars value={mine.rating} />
          </View>
          {mine.comment ? <Text variant="callout">{mine.comment}</Text> : null}
          <Button title="Bearbeiten" variant="secondary" size="md" fullWidth={false} onPress={onWrite} />
        </View>
      ) : (
        <Button title="Parkhaus bewerten" variant="secondary" icon="star-outline" size="md" onPress={onWrite} />
      )}

      {reviews.isPending ? (
        <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
          <Skeleton height={60} />
          <Skeleton height={60} />
        </View>
      ) : (
        <View style={{ marginTop: spacing.md }}>
          {items.map((r, i) => (
            <View key={r.id}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.review}>
                <View style={styles.reviewHead}>
                  <Avatar name={r.authorName} size={32} />
                  <View style={{ flex: 1 }}>
                    <Text variant="captionStrong">{r.authorName}</Text>
                    <Text variant="caption" tone="tertiary">
                      {dateFmt.format(new Date(r.createdAt))}
                    </Text>
                  </View>
                  <Stars value={r.rating} size={12} />
                  <Pressable onPress={() => askReport(r)} hitSlop={12} accessibilityLabel="Bewertung melden">
                    <Ionicons name="ellipsis-horizontal" size={18} color={colors.inkTertiary} />
                  </Pressable>
                </View>
                {r.comment ? <Text variant="callout">{r.comment}</Text> : null}
              </View>
            </View>
          ))}
          {reviews.hasNextPage ? (
            <Button
              title="Weitere Bewertungen"
              variant="ghost"
              size="md"
              loading={reviews.isFetchingNextPage}
              onPress={() => void reviews.fetchNextPage()}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.lg },
  review: { gap: spacing.sm, paddingVertical: spacing.md },
  mine: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
