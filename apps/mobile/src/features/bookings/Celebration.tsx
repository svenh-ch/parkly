import { useEffect, useMemo } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { colors, radius, spacing, Text } from '@/ui';
import { TIER } from './format';
import type { LoyaltyTier } from '@parking/shared';

const CONFETTI_COLORS = ['#1F4FD8', '#01184A', '#12805C', '#F5A524', '#E11D48', '#7C3AED', '#22C3EE'];

function haptic(kind: 'success' | 'light') {
  if (Platform.OS === 'web') return;
  if (kind === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

/** Grosser Haken: Kreis springt auf, Haken ploppt, Welle läuft nach aussen. */
export function SuccessCheck({ size = 96, delay = 150 }: { size?: number; delay?: number }) {
  const circle = useSharedValue(0);
  const check = useSharedValue(0);
  const ring = useSharedValue(0);

  useEffect(() => {
    circle.value = withDelay(delay, withSpring(1, { damping: 12, stiffness: 160 }));
    check.value = withDelay(delay + 220, withSpring(1, { damping: 9, stiffness: 220 }));
    ring.value = withDelay(delay + 200, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
    const t = setTimeout(() => haptic('success'), delay + 220);
    return () => clearTimeout(t);
  }, [circle, check, ring, delay]);

  const circleStyle = useAnimatedStyle(() => ({ transform: [{ scale: circle.value }] }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: check.value,
    transform: [{ scale: interpolate(check.value, [0, 1], [0.3, 1]) }, { rotate: `${interpolate(check.value, [0, 1], [-25, 0])}deg` }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ring.value, [0, 0.2, 1], [0, 0.5, 0]),
    transform: [{ scale: interpolate(ring.value, [0, 1], [0.9, 1.9]) }],
  }));

  return (
    <View style={{ width: size * 2, height: size * 1.7, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Bezahlt">
      <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: colors.success }, ringStyle]} />
      <Animated.View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }, circleStyle]}>
        <Animated.View style={checkStyle}>
          <Ionicons name="checkmark" size={size * 0.62} color={colors.onPrimary} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function Piece({ x, delay, color, w, h, drift, spin, fall }: { x: number; delay: number; color: string; w: number; h: number; drift: number; spin: number; fall: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withTiming(1, { duration: 2600 + Math.random() * 900, easing: Easing.out(Easing.quad) }));
  }, [p, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.05, 0.8, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: x + Math.sin(p.value * 6) * drift },
      { translateY: interpolate(p.value, [0, 1], [-40, fall]) },
      { rotate: `${p.value * spin}deg` },
      { rotateX: `${p.value * spin * 1.5}deg` },
    ],
  }));
  return <Animated.View style={[{ position: 'absolute', top: 0, left: 0, width: w, height: h, borderRadius: 2, backgroundColor: color }, style]} />;
}

/** Konfetti, das von oben fällt (einmalig, blockiert keine Eingaben). */
export function Confetti({ count = 44 }: { count?: number }) {
  const { width, height } = useWindowDimensions();
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        key: i,
        x: Math.random() * width,
        delay: 250 + Math.random() * 500,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
        w: 6 + Math.random() * 6,
        h: 10 + Math.random() * 8,
        drift: 10 + Math.random() * 30,
        spin: 360 + Math.random() * 720,
        fall: height * (0.55 + Math.random() * 0.45),
      })),
    [count, width, height],
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map(({ key, ...p }) => (
        <Piece key={key} {...p} />
      ))}
    </View>
  );
}

/** Einblenden von unten, gestaffelt. */
export function Rise({ delay, children }: { delay: number; children: React.ReactNode }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(delay, withSpring(1, { damping: 16, stiffness: 140 }));
  }, [v, delay]);
  const style = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: interpolate(v.value, [0, 1], [24, 0]) }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * Status-Fortschritt: der Balken füllt sich animiert, die kommende Buchung ist heller vorgemerkt.
 */
export function TierProgress({
  tier,
  points,
  nextTier,
  nextPoints,
  prevPoints,
  pendingPoints = 0,
  delay = 900,
}: {
  tier: LoyaltyTier;
  points: number;
  nextTier: LoyaltyTier | null;
  nextPoints: number | null;
  prevPoints: number;
  pendingPoints?: number;
  delay?: number;
}) {
  const t = TIER[tier];
  const span = nextPoints ? nextPoints - prevPoints : 1;
  const done = nextPoints ? Math.min(1, (points - prevPoints) / span) : 1;
  const pending = nextPoints ? Math.min(1, (points + pendingPoints - prevPoints) / span) : 1;
  const a = useSharedValue(0);
  const b = useSharedValue(0);
  useEffect(() => {
    a.value = withDelay(delay, withTiming(done, { duration: 700, easing: Easing.out(Easing.cubic) }));
    b.value = withDelay(delay + 500, withSequence(withTiming(pending, { duration: 600, easing: Easing.out(Easing.cubic) })));
    const h = setTimeout(() => haptic('light'), delay + 1000);
    return () => clearTimeout(h);
  }, [a, b, done, pending, delay]);
  const doneStyle = useAnimatedStyle(() => ({ width: `${a.value * 100}%` }));
  const pendingStyle = useAnimatedStyle(() => ({ width: `${b.value * 100}%` }));
  const remaining = nextPoints ? Math.max(0, nextPoints - points - pendingPoints) : 0;

  return (
    <View style={[styles.tierCard, { backgroundColor: t.soft }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Ionicons name={t.icon} size={20} color={t.color} />
        <Text variant="bodyStrong" style={{ color: t.color }}>
          Status {t.label}
        </Text>
        <View style={{ flex: 1 }} />
        {nextTier ? (
          <Text variant="captionStrong" style={{ color: TIER[nextTier].color }}>
            {TIER[nextTier].label}
          </Text>
        ) : null}
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { backgroundColor: t.color, opacity: 0.35 }, pendingStyle]} />
        <Animated.View style={[styles.fill, { backgroundColor: t.color }, doneStyle]} />
      </View>
      <Text variant="caption" tone="secondary">
        {nextTier
          ? remaining === 0
            ? `Nach dem Parken erreichst du ${TIER[nextTier].label}!`
            : pendingPoints
              ? `Diese Buchung zählt nach dem Parken. Danach noch ${remaining} bis ${TIER[nextTier].label}.`
              : `Noch ${remaining} ${remaining === 1 ? 'Buchung' : 'Buchungen'} bis ${TIER[nextTier].label}.`
          : 'Höchster Status erreicht. Danke!'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  tierCard: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  track: { height: 10, borderRadius: 5, backgroundColor: 'rgba(0,0,0,0.06)', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 5 },
});
