import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { colors, typography, type TypographyVariant } from './theme';

type Tone = 'default' | 'secondary' | 'tertiary' | 'primary' | 'danger' | 'inverse';

const toneColor: Record<Tone, string> = {
  default: colors.ink,
  secondary: colors.inkSecondary,
  tertiary: colors.inkTertiary,
  primary: colors.primary,
  danger: colors.danger,
  inverse: colors.onPrimary,
};

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  tone?: Tone;
  align?: 'left' | 'center' | 'right';
}

export function Text({ variant = 'body', tone = 'default', align, style, ...rest }: TextProps) {
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      style={[typography[variant], { color: toneColor[tone] }, align && { textAlign: align }, style]}
      {...rest}
    />
  );
}
