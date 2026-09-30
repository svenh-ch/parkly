import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, spacing, Text } from '@/ui';
import type { PayMethod } from './checkout';

const twintLogo = require('../../../assets/images/twint.png');

function Option({ on, onPress, icon, title, subtitle, disabled }: { on: boolean; onPress: () => void; icon: React.ReactNode; title: string; subtitle: string; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled }}
      accessibilityLabel={title}
      style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && !on && { backgroundColor: colors.surface }, disabled && { opacity: 0.5 }]}
    >
      <View style={styles.icon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" tone="secondary">
          {subtitle}
        </Text>
      </View>
      <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
    </Pressable>
  );
}

/** Auswahl der Zahlungsart: TWINT (direkt zur TWINT-App) oder Karte / Apple Pay. */
export function MethodPicker({ value, onChange, disabled }: { value: PayMethod; onChange: (m: PayMethod) => void; disabled?: boolean }) {
  return (
    <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
      <Option
        on={value === 'twint'}
        onPress={() => onChange('twint')}
        disabled={disabled}
        icon={<Image source={twintLogo} style={{ width: 31, height: 44 }} accessibilityIgnoresInvertColors />}
        title="TWINT"
        subtitle="In der TWINT-App bestätigen"
      />
      <Option
        on={value === 'card'}
        onPress={() => onChange('card')}
        disabled={disabled}
        icon={<Ionicons name="card-outline" size={26} color={colors.accent} />}
        title={Platform.OS === 'ios' ? 'Karte oder Apple Pay' : Platform.OS === 'android' ? 'Karte oder Google Pay' : 'Karte'}
        subtitle="Visa, Mastercard, Amex"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.background },
  optionOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
});
