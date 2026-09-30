import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from './Text';
import { colors, radius, shadows, spacing, touchTarget } from './theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [styles.card, shadows.card, style, pressed && { transform: [{ scale: 0.99 }] }]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, shadows.card, style]}>{children}</View>;
}

/** Grosser Seitentitel im Apple-Stil. */
export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text variant="display" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="callout" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.section}>
      <Text variant="headline" accessibilityRole="header">
        {children}
      </Text>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={10} accessibilityRole="button">
          <Text variant="captionStrong" style={{ color: colors.accent }}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'primary' | 'warning' }) {
  const bg = { neutral: colors.surface, primary: colors.accentSoft, warning: colors.warningSoft }[tone];
  const fg = { neutral: colors.inkSecondary, primary: colors.accent, warning: colors.warning }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text variant="micro" style={{ color: fg }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

/** Zeile in Listen/Menüs (Profil, Einstellungen). */
export function ListRow({
  icon,
  title,
  subtitle,
  onPress,
  badge,
  destructive,
  disabled,
  showChevron = true,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  badge?: string;
  destructive?: boolean;
  disabled?: boolean;
  showChevron?: boolean;
}) {
  const color = destructive ? colors.danger : colors.ink;
  const iconColor = destructive ? colors.danger : colors.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }, disabled && { opacity: 0.5 }]}
    >
      {icon ? <Ionicons name={icon} size={22} color={iconColor} /> : null}
      <View style={{ flex: 1 }}>
        <Text variant="body" style={{ color }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {badge ? <Badge label={badge} /> : null}
      {showChevron && onPress && !disabled ? <Ionicons name="chevron-forward" size={18} color={colors.inkTertiary} /> : null}
    </Pressable>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: inset }} />;
}

export function Avatar({ name, size = 56 }: { name: string; size?: number }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?';
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}
      accessibilityLabel={`Profilbild von ${name}`}
    >
      <Text variant={size > 48 ? 'headline' : 'captionStrong'} tone="inverse">
        {initials}
      </Text>
    </View>
  );
}

/** Segment-Umschalter (z. B. Bevorstehend / Vergangen). */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && [styles.segmentSelected, shadows.card]]}
          >
            <Text variant="captionStrong" style={{ color: selected ? colors.primary : colors.inkSecondary }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xxl, marginBottom: spacing.md },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, minHeight: touchTarget + 8, paddingVertical: spacing.md },
  segmented: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md - 3 },
  segmentSelected: { backgroundColor: colors.background },
});
