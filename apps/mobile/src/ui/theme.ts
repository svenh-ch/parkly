import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Design-Tokens. Alle Farben, Abstände, Radien und Schriftgrössen der App kommen von hier.
 * Komponenten verwenden nie Hex-Werte direkt, damit Branding und Dark Mode später
 * an einer Stelle umgesetzt werden können.
 */

export const colors = {
  // Neutrals
  ink: '#111418',
  inkSecondary: '#5E6570',
  inkTertiary: '#8A919C',
  background: '#FFFFFF',
  surface: '#F6F7F9',
  surfacePressed: '#ECEEF1',
  border: '#E6E8EC',
  borderStrong: '#CDD1D7',

  // Marke (aus dem Logo): Navy für Flächen/Buttons, Königsblau als Akzent
  primary: '#01184A',
  primaryPressed: '#000E2E',
  primarySoft: '#E8ECF5',
  onPrimary: '#FFFFFF',
  accent: '#1F4FD8',
  accentPressed: '#1A43B8',
  accentSoft: '#EDF2FF',

  // Kartentypen (Karte, Badges)
  marketplace: '#01184A',
  publicParking: '#FFFFFF',
  publicParkingAccent: '#1F4FD8',
  occupancyHigh: '#12805C',
  occupancyLow: '#B25E09',
  occupancyNone: '#D93025',
  favorite: '#E11D48',
  favoritePressed: '#BE123C',
  star: '#F5A524',

  // Status
  danger: '#D93025',
  dangerSoft: '#FDECEA',
  success: '#12805C',
  successSoft: '#E7F5EF',
  warning: '#B25E09',
  warningSoft: '#FFF4E5',

  overlay: 'rgba(17, 20, 24, 0.45)',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

/** Standard-Seitenrand */
export const gutter = spacing.xl;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

const fontFamily = Platform.select({ ios: 'System', default: undefined });

export const typography = {
  display: { fontFamily, fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontFamily, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4 },
  headline: { fontFamily, fontSize: 18, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontFamily, fontSize: 16, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontFamily, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  callout: { fontFamily, fontSize: 15, lineHeight: 20, fontWeight: '400' },
  caption: { fontFamily, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  captionStrong: { fontFamily, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  micro: { fontFamily, fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 0.3 },
} as const satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

export const shadows = {
  card: Platform.select<ViewStyle>({
    ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 2 },
    default: { boxShadow: '0 4px 12px rgba(0,0,0,0.06)' },
  }),
  floating: Platform.select<ViewStyle>({
    ios: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
    android: { elevation: 6 },
    default: { boxShadow: '0 8px 20px rgba(0,0,0,0.12)' },
  }),
} as const;

/** Mindestgrösse für Touch-Ziele (Apple HIG: 44pt). */
export const touchTarget = 48;
