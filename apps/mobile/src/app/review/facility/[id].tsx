import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { REVIEW_COMMENT_MAX } from '@parking/shared';
import { StarInput } from '@/features/social/components';
import { useDeleteFacilityReview, useFacilityReviews, useUpsertFacilityReview } from '@/features/social/queries';
import { userMessage } from '@/lib/errors';
import { Banner, Button, Screen, ScreenHeader, Skeleton, spacing, Text, TextField } from '@/ui';

export default function ReviewFacility() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const reviews = useFacilityReviews(id);
  if (reviews.isPending) {
    return (
      <Screen edges={['bottom']} contentStyle={{ gap: spacing.lg, paddingTop: spacing.xl }}>
        <Skeleton height={40} />
        <Skeleton height={140} />
      </Screen>
    );
  }
  const mine = reviews.data?.pages[0]?.mine ?? null;
  return <Editor id={id!} name={name} initial={mine ? { rating: mine.rating, comment: mine.comment ?? '' } : null} />;
}

function Editor({ id, name, initial }: { id: string; name?: string; initial: { rating: number; comment: string } | null }) {
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useUpsertFacilityReview(id);
  const remove = useDeleteFacilityReview(id);

  const onSave = () => {
    if (rating < 1) {
      setError('Bitte wähle 1 bis 5 Sterne.');
      return;
    }
    setError(null);
    save.mutate(
      { rating, comment },
      { onSuccess: () => router.back(), onError: (e) => setError(userMessage(e)) },
    );
  };

  const onDelete = () =>
    Alert.alert('Bewertung löschen?', undefined, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => remove.mutate(undefined, { onSuccess: () => router.back(), onError: (e) => setError(userMessage(e)) }),
      },
    ]);

  return (
    <Screen
      keyboard
      edges={['bottom']}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button title={initial ? 'Änderungen speichern' : 'Bewertung veröffentlichen'} loading={save.isPending} onPress={onSave} />
          {initial ? <Button title="Bewertung löschen" variant="ghost" loading={remove.isPending} onPress={onDelete} /> : null}
        </View>
      }
    >
      <Stack.Screen options={{ title: '' }} />
      <ScreenHeader title={initial ? 'Bewertung bearbeiten' : 'Wie war es?'} subtitle={name} />
      <View style={{ gap: spacing.xl }}>
        {error ? <Banner>{error}</Banner> : null}
        <StarInput
          value={rating}
          onChange={(v) => {
            setRating(v);
            setError(null);
          }}
        />
        <TextField
          label="Kommentar (optional)"
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={REVIEW_COMMENT_MAX}
          style={{ minHeight: 120, textAlignVertical: 'top' }}
          placeholder="Einfahrt, Platzgrösse, Sauberkeit, Preis-Leistung ..."
          hint={`${comment.length}/${REVIEW_COMMENT_MAX} Zeichen`}
        />
        <Text variant="caption" tone="tertiary">
          Deine Bewertung ist öffentlich und erscheint mit deinem Vornamen und dem ersten Buchstaben des Nachnamens.
        </Text>
      </View>
    </Screen>
  );
}
