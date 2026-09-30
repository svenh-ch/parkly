import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { hostPayout } from '@parking/shared';
import { colors, radius, spacing, Text, typography } from '@/ui';
import { chf, parseChf } from './labels';

/** Auswahl-Chips (einzeln oder mehrfach). */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  multiple = false,
}: {
  options: { value: T; label: string }[];
  value: T[];
  onChange: (value: T[]) => void;
  multiple?: boolean;
}) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <Pressable
            key={o.value}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityState={multiple ? { checked: on } : { selected: on }}
            onPress={() => onChange(multiple ? (on ? value.filter((v) => v !== o.value) : [...value, o.value]) : [o.value])}
            style={[styles.chip, on && styles.chipOn]}
          >
            {on && multiple ? <Ionicons name="checkmark" size={14} color={colors.onPrimary} /> : null}
            <Text variant="captionStrong" style={{ color: on ? colors.onPrimary : colors.ink }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FieldLabel({ children, hint }: { children: string; hint?: string }) {
  return (
    <View style={{ gap: 2, marginBottom: spacing.sm }}>
      <Text variant="bodyStrong">{children}</Text>
      {hint ? (
        <Text variant="caption" tone="secondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.xxl }}>
      <FieldLabel hint={hint}>{title}</FieldLabel>
      {children}
    </View>
  );
}

export function SwitchRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable style={styles.switchRow} onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body">{label}</Text>
        {hint ? (
          <Text variant="caption" tone="secondary">
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.borderStrong }} />
    </Pressable>
  );
}

/** Kleines Zahlenfeld mit Einheit, z. B. "180 cm". Leer = null. */
export function NumberInput({
  value,
  onChange,
  unit,
  placeholder,
  accessibilityLabel,
  decimals = false,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  unit: string;
  placeholder?: string;
  accessibilityLabel: string;
  decimals?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  return (
    <View style={styles.inputBox}>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          const n = Number(t.replace(',', '.'));
          onChange(t.trim() === '' || !Number.isFinite(n) ? null : decimals ? n : Math.round(n));
        }}
        keyboardType={decimals ? 'decimal-pad' : 'number-pad'}
        placeholder={placeholder}
        placeholderTextColor={colors.inkTertiary}
        style={styles.input}
        accessibilityLabel={accessibilityLabel}
      />
      <Text variant="callout" tone="secondary">
        {unit}
      </Text>
    </View>
  );
}

/** Preisfeld in CHF mit Live-Anzeige der Auszahlung nach Plattformgebühr. */
export function PriceRow({
  label,
  value,
  onChange,
  feeBps,
}: {
  label: string;
  value: number | null;
  onChange: (rappen: number | null) => void;
  feeBps: number;
}) {
  const [text, setText] = useState(value === null ? '' : (value / 100).toFixed(2).replace(/\.00$/, ''));
  useEffect(() => {
    if (parseChf(text) !== value) setText(value === null ? '' : (value / 100).toFixed(2).replace(/\.00$/, ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <View style={styles.priceRow}>
      <View style={{ flex: 1 }}>
        <Text variant="body">{label}</Text>
        <Text variant="caption" tone={value ? 'secondary' : 'tertiary'}>
          {value ? `Du erhältst CHF ${chf(hostPayout(value, feeBps))} nach Plattformgebühr` : 'Nicht angeboten'}
        </Text>
      </View>
      <View style={[styles.inputBox, { width: 130 }]}>
        <Text variant="callout" tone="secondary">
          CHF
        </Text>
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            onChange(parseChf(t));
          }}
          keyboardType="decimal-pad"
          placeholder="–"
          placeholderTextColor={colors.inkTertiary}
          style={[styles.input, { textAlign: 'right' }]}
          accessibilityLabel={`Preis ${label}`}
        />
      </View>
    </View>
  );
}

export function StepHeader({ step, total, title }: { step: number; total: number; title: string }) {
  return (
    <View style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
      <Text variant="captionStrong" tone="secondary">
        Schritt {step + 1} von {total}
      </Text>
      <View style={styles.progress}>
        <View style={[styles.progressFill, { width: `${((step + 1) / total) * 100}%` }]} />
      </View>
      <Text variant="title">{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.lg,
    minHeight: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.background,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    backgroundColor: colors.background,
  },
  input: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: spacing.sm, minWidth: 40 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  progress: { height: 4, borderRadius: 2, backgroundColor: colors.surface, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
});
