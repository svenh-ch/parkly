import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from './Text';
import { colors, radius, spacing, touchTarget } from './theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ComponentProps<typeof Ionicons>['name'];
  fullWidth?: boolean;
  style?: ViewStyle;
  trailing?: ReactNode;
}

const palette: Record<Variant, { bg: string; bgPressed: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, bgPressed: colors.primaryPressed, fg: colors.onPrimary },
  secondary: { bg: colors.background, bgPressed: colors.surface, fg: colors.ink, border: colors.borderStrong },
  ghost: { bg: 'transparent', bgPressed: colors.surface, fg: colors.ink },
  danger: { bg: colors.background, bgPressed: colors.dangerSoft, fg: colors.danger, border: colors.danger },
};

export function Button({
  title,
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled,
  icon,
  fullWidth = true,
  style,
  trailing,
  ...rest
}: ButtonProps) {
  const p = palette[variant];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      accessibilityLabel={title}
      disabled={isDisabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
        {
          backgroundColor: pressed ? p.bgPressed : p.bg,
          borderColor: p.border ?? 'transparent',
          opacity: isDisabled && !loading ? 0.45 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.content}>
          {icon ? <Ionicons name={icon} size={18} color={p.fg} /> : null}
          <Text variant="bodyStrong" style={{ color: p.fg }}>
            {title}
          </Text>
          {trailing}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  lg: { minHeight: 54 },
  md: { minHeight: touchTarget - 4 },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
