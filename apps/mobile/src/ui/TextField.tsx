import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from './Text';
import { colors, radius, spacing, typography } from './theme';

export interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string;
  hint?: string;
  /** Zeigt einen Umschalter zum Einblenden des Passworts. */
  password?: boolean;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, password, style, onFocus, onBlur, editable = true, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const borderColor = error ? colors.danger : focused ? colors.accent : colors.border;

  return (
    <View style={styles.wrapper}>
      <Text variant="captionStrong" tone="secondary" nativeID={`${label}-label`}>
        {label}
      </Text>
      <View style={[styles.field, { borderColor, backgroundColor: editable ? colors.background : colors.surface }]}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityLabelledBy={`${label}-label`}
          placeholderTextColor={colors.inkTertiary}
          selectionColor={colors.accent}
          secureTextEntry={password && !revealed}
          autoCorrect={false}
          editable={editable}
          style={[styles.input, style]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {password ? (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Passwort verbergen' : 'Passwort anzeigen'}
            hitSlop={12}
            style={styles.reveal}
          >
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.inkSecondary} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="tertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs + 2 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radius.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  input: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: spacing.md },
  reveal: { paddingLeft: spacing.sm },
});
