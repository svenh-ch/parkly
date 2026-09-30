import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing, Text } from '@/ui';

/** Web-Vorschau: Karte mit verschiebbarem Pin gibt es nur in der App. */
export function LocationPicker({ value }: { value: { lat: number; lng: number }; onChange: (p: { lat: number; lng: number }) => void }) {
  return (
    <View style={styles.wrap}>
      <Text variant="bodyStrong">Position {value.lat.toFixed(5)}, {value.lng.toFixed(5)}</Text>
      <Text variant="caption" tone="secondary">
        In der App kannst du den Pin hier auf der Karte verschieben.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 120, borderRadius: radius.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
});
