import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from './Text';
import { colors, radius, spacing } from './theme';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  error?: string;
}

export function Checkbox({ checked, onChange, label, error }: CheckboxProps) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={() => onChange(!checked)}
        style={styles.row}
        hitSlop={6}
      >
        <View
          style={[
            styles.box,
            { backgroundColor: checked ? colors.primary : colors.background, borderColor: error ? colors.danger : checked ? colors.primary : colors.borderStrong },
          ]}
        >
          {checked ? <Ionicons name="checkmark" size={16} color={colors.onPrimary} /> : null}
        </View>
        <View style={{ flex: 1 }}>
          {typeof label === 'string' ? (
            <Text variant="callout" tone="secondary">
              {label}
            </Text>
          ) : (
            label
          )}
        </View>
      </Pressable>
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, minHeight: 44, paddingVertical: spacing.xs },
  box: {
    width: 22,
    height: 22,
    borderRadius: radius.sm - 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
});
