import { useRef } from 'react';
import { Alert, Animated, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { FavoriteTarget, RatingSummary } from '@parking/shared';
import { userMessage } from '@/lib/errors';
import { colors, radius, spacing, Text } from '@/ui';
import { useToggleFavorite } from './queries';

/** Herz zum Speichern als Favorit. Reagiert sofort (optimistisch). */
export function FavoriteButton({
  target,
  isFavorite,
  size = 22,
  style,
  variant = 'plain',
}: {
  target: FavoriteTarget;
  isFavorite: boolean;
  size?: number;
  style?: ViewStyle;
  variant?: 'plain' | 'circle';
}) {
  const toggle = useToggleFavorite();
  const scale = useRef(new Animated.Value(1)).current;

  const onPress = () => {
    const value = !isFavorite;
    if (value) {
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.3, useNativeDriver: true, speed: 50 }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30 }),
      ]).start();
    }
    toggle.mutate(
      { target, value },
      { onError: (e) => Alert.alert('Favorit nicht gespeichert', userMessage(e)) },
    );
  };

  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityState={{ selected: isFavorite }}
      accessibilityLabel={isFavorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
      style={[variant === 'circle' && styles.circle, style]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons
          name={isFavorite ? 'heart' : 'heart-outline'}
          size={size}
          color={isFavorite ? colors.favorite : colors.ink}
        />
      </Animated.View>
    </Pressable>
  );
}

/** "★ 4.5 (12)" bzw. "Noch keine Bewertungen" */
export function RatingInline({ rating, emptyText }: { rating: RatingSummary; emptyText?: string }) {
  if (!rating.count || rating.avg === null) {
    return emptyText ? (
      <Text variant="caption" tone="tertiary">
        {emptyText}
      </Text>
    ) : null;
  }
  return (
    <View style={styles.inline} accessibilityLabel={`${rating.avg.toFixed(1)} von 5 Sternen, ${rating.count} Bewertungen`}>
      <Ionicons name="star" size={13} color={colors.star} />
      <Text variant="captionStrong">{rating.avg.toFixed(1)}</Text>
      <Text variant="caption" tone="secondary">
        ({rating.count})
      </Text>
    </View>
  );
}

/** Sterne-Anzeige (nur lesen). */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <View style={styles.inline} accessibilityLabel={`${value} von 5 Sternen`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons
          key={i}
          name={value >= i ? 'star' : value >= i - 0.5 ? 'star-half' : 'star-outline'}
          size={size}
          color={colors.star}
        />
      ))}
    </View>
  );
}

/** Sterne-Eingabe (1–5), grosse Touch-Ziele. */
export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const labels = ['', 'Schlecht', 'Mässig', 'Okay', 'Gut', 'Ausgezeichnet'];
  return (
    <View style={{ alignItems: 'center', gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', gap: spacing.sm }} accessibilityRole="adjustable">
        {[1, 2, 3, 4, 5].map((i) => (
          <Pressable
            key={i}
            onPress={() => onChange(i)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${i} ${i === 1 ? 'Stern' : 'Sterne'}`}
            accessibilityState={{ selected: value === i }}
          >
            <Ionicons name={value >= i ? 'star' : 'star-outline'} size={40} color={value >= i ? colors.star : colors.borderStrong} />
          </Pressable>
        ))}
      </View>
      <Text variant="captionStrong" tone="secondary" style={{ minHeight: 18 }}>
        {labels[value] ?? ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
