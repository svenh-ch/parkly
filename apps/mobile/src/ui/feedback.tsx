import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { Animated, StyleSheet, View, type DimensionValue, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button } from './Button';
import { Text } from './Text';
import { colors, radius, spacing } from './theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Leerer Zustand mit Icon, Erklärung und optionaler Aktion. */
export function EmptyState({
  icon,
  title,
  message,
  action,
  style,
}: {
  icon: IconName;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.empty, style]}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={28} color={colors.accent} />
      </View>
      <Text variant="headline" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="callout" tone="secondary" align="center" style={styles.emptyMessage}>
          {message}
        </Text>
      ) : null}
      {action ? (
        <Button title={action.label} variant="secondary" size="md" fullWidth={false} onPress={action.onPress} style={{ marginTop: spacing.sm }} />
      ) : null}
    </View>
  );
}

/** Fehlerzustand mit "Erneut versuchen". */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="Das hat nicht geklappt"
      message={message}
      action={onRetry ? { label: 'Erneut versuchen', onPress: onRetry } : undefined}
    />
  );
}

/** Pulsierender Platzhalter für Ladezustände. */
export function Skeleton({
  width = '100%',
  height = 16,
  rounded = radius.sm,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  rounded?: number;
  style?: ViewStyle;
}) {
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: rounded, backgroundColor: colors.surfacePressed, opacity }, style]}
    />
  );
}

/** Hinweisbox, z. B. für Formularfehler. */
export function Banner({ tone = 'danger', children }: { tone?: 'danger' | 'success' | 'info'; children: ReactNode }) {
  const map = {
    danger: { bg: colors.dangerSoft, fg: colors.danger, icon: 'alert-circle' as const },
    success: { bg: colors.successSoft, fg: colors.success, icon: 'checkmark-circle' as const },
    info: { bg: colors.surface, fg: colors.ink, icon: 'information-circle' as const },
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: map.bg }]} accessibilityRole="alert">
      <Ionicons name={map.icon} size={18} color={map.fg} />
      <Text variant="callout" style={{ color: map.fg, flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.huge, paddingHorizontal: spacing.xl, gap: spacing.sm },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyMessage: { maxWidth: 300 },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
  },
});
