import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PaymentSession } from '@parking/shared';
import { CANCELLATION_LABEL } from '@/features/host/labels';
import { dayLabel, durationLabel, money, pct, TIER, time } from '@/features/bookings/format';
import { useBookingCache, usePaymentConfig } from '@/features/bookings/queries';
import { usePay, usePayMethod } from '@/features/payments/usePay';
import { MethodPicker } from '@/features/payments/MethodPicker';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { Banner, Button, colors, Divider, ErrorState, radius, Screen, Skeleton, spacing, Text } from '@/ui';

const Q = 15 * 60_000;
const DAYS = 14;
const TIME_CHIP = 72;
const DURATIONS = [60, 120, 180, 240, 480, 1440, 2880, 10080];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Früheste buchbare Viertelstunde (jetzt aufgerundet + Vorlaufzeit). */
function earliest(leadMinutes: number) {
  return new Date(Math.ceil((Date.now() + leadMinutes * 60_000) / Q) * Q);
}

function Chip({ label, sub, on, onPress, disabled, width }: { label: string; sub?: string; on: boolean; onPress: () => void; disabled?: boolean; width?: number }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled }}
      style={({ pressed }) => [styles.chip, width ? { width, minWidth: width } : null, on && styles.chipOn, pressed && !on && { backgroundColor: colors.surfacePressed }, disabled && { opacity: 0.35 }]}
    >
      {sub ? (
        <Text variant="micro" style={{ color: on ? colors.onPrimary : colors.inkSecondary }}>
          {sub.toUpperCase()}
        </Text>
      ) : null}
      <Text variant="captionStrong" style={{ color: on ? colors.onPrimary : colors.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function BookScreen() {
  const { spotId } = useLocalSearchParams<{ spotId: string }>();
  const spot = useQuery({ queryKey: ['spot', spotId], queryFn: () => api.spots.detail(spotId), enabled: !!spotId });
  const config = usePaymentConfig();
  const cache = useBookingCache();
  const { pay, paying } = usePay();
  const [method, setMethod] = usePayMethod();

  const lead = spot.data?.leadTimeMinutes ?? 60;
  const first = useMemo(() => earliest(lead), [lead]);
  const [day, setDay] = useState(() => startOfDay(new Date()).getTime());
  const [start, setStart] = useState<number | null>(null);
  const [minutes, setMinutes] = useState(120);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ bookingId: string; session: PaymentSession; holdUntil: string | null } | null>(null);
  const timesRef = useRef<ScrollView>(null);

  // Startzeit an Tag und Vorlauf anpassen (heute: nächste freie Viertelstunde, sonst 08:00)
  useEffect(() => {
    if (!spot.data) return;
    const firstDay = startOfDay(first).getTime();
    if (day < firstDay) {
      setDay(firstDay);
      return;
    }
    if (start === null || start < first.getTime()) setStart(day === firstDay ? first.getTime() : day + 8 * 60 * 60_000);
  }, [day, first, spot.data, start]);

  // Gewählte Startzeit sichtbar machen
  const scrolledDay = useRef<number | null>(null);
  useEffect(() => {
    if (start === null || scrolledDay.current === day) return;
    scrolledDay.current = day;
    const idx = Math.round((start - Math.max(day, first.getTime())) / Q);
    const t = setTimeout(() => timesRef.current?.scrollTo({ x: Math.max(0, idx * (TIME_CHIP + spacing.sm) - spacing.xl), animated: true }), 50);
    return () => clearTimeout(t);
  }, [start, day, first]);

  useEffect(() => {
    if (spot.data) setMinutes((m) => Math.min(Math.max(m, spot.data.minDurationMinutes), spot.data.maxDurationMinutes));
  }, [spot.data]);

  const startAt = start ? new Date(start).toISOString() : null;
  const endAt = start ? new Date(start + minutes * 60_000).toISOString() : null;
  const quote = useQuery({
    queryKey: ['quote', spotId, startAt, endAt],
    queryFn: ({ signal }) => api.bookings.quote(spotId, startAt!, endAt!, signal),
    enabled: !!startAt && !!endAt && !pending,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  });

  if (spot.isPending) {
    return (
      <Screen edges={['bottom']}>
        <Skeleton height={28} width="70%" />
        <Skeleton height={80} rounded={radius.lg} style={{ marginTop: spacing.xl }} />
        <Skeleton height={160} rounded={radius.lg} style={{ marginTop: spacing.xl }} />
      </Screen>
    );
  }
  if (spot.isError) return <ErrorState message={userMessage(spot.error)} onRetry={() => void spot.refetch()} />;
  const s = spot.data;

  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() + i);
    return d;
  });
  const dayEnd = day + 24 * 60 * 60_000;
  const slots: number[] = [];
  for (let t = Math.max(day, first.getTime()); t < dayEnd; t += Q) slots.push(t);
  const durations = DURATIONS.filter((d) => d >= s.minDurationMinutes && d <= s.maxDurationMinutes);

  const q = quote.data;
  const quoteError = quote.isError ? userMessage(quote.error) : null;
  const eventBlocked = q?.event && !q.event.canBookNow;
  const early = q?.event && q.event.canBookNow && new Date(q.event.publicOpenAt) > new Date();

  const submit = async () => {
    setError(null);
    try {
      let current = pending;
      if (!current) {
        setCreating(true);
        const res = await api.bookings.create({ spotId, startAt: startAt!, endAt: endAt! });
        current = { bookingId: res.booking.id, session: res.payment, holdUntil: res.booking.holdExpiresAt };
        setPending(current);
        setCreating(false);
      }
      const b = await pay(current.bookingId, current.session, method, (x) => x.status !== 'PENDING_PAYMENT');
      if (!b) {
        setError(`Zahlung abgebrochen. Der Platz bleibt für dich reserviert${current.holdUntil ? ` bis ${time(new Date(current.holdUntil))}` : ''}.`);
        return;
      }
      cache(b);
      router.replace({ pathname: '/booking/success', params: { id: b.id } });
    } catch (e) {
      setCreating(false);
      setError(e instanceof Error && !('status' in e) ? e.message : userMessage(e));
    }
  };

  const busy = creating || paying;
  const cta = quoteError
    ? 'Bitte andere Zeit wählen'
    : !q
    ? 'Preis wird berechnet …'
    : `${!s.instantBook ? 'Anfrage senden' : method === 'twint' ? 'Mit TWINT bezahlen' : 'Jetzt bezahlen'} · ${money(q.total, q.currency)}`;

  return (
    <Screen
      edges={['bottom']}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button title={pending ? `Weiter bezahlen · ${money(pending.session.amount)}` : cta} icon={method === 'twint' ? 'phone-portrait-outline' : 'lock-closed'} loading={busy} disabled={!q || !!quoteError || !!eventBlocked} onPress={() => void submit()} />
          {config.data?.provider === 'dev' ? (
            <Text variant="caption" tone="tertiary" align="center">
              Testmodus: es wird nichts belastet.
            </Text>
          ) : (
            <Text variant="caption" tone="tertiary" align="center">
              Sichere Zahlung über Stripe. Parkly speichert keine Kartendaten.
            </Text>
          )}
        </View>
      }
    >
      <Stack.Screen options={{ title: 'Buchen' }} />
      <Text variant="title" numberOfLines={2}>
        {s.title}
      </Text>
      <Text variant="callout" tone="secondary">
        {s.area}
      </Text>

      <Text variant="bodyStrong" style={styles.label}>
        Wann?
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {days.map((d) => {
          const lastSlot = d.getTime() + 24 * 60 * 60_000 - Q;
          return (
            <Chip
              key={d.getTime()}
              sub={dayLabel(d).split(',')[0]}
              label={d.toLocaleDateString('de-CH', { day: 'numeric', month: 'short' })}
              on={day === d.getTime()}
              disabled={lastSlot < first.getTime() || !!pending}
              onPress={() => {
                setDay(d.getTime());
                setStart(null);
                timesRef.current?.scrollTo({ x: 0, animated: false });
              }}
            />
          );
        })}
      </ScrollView>

      <Text variant="bodyStrong" style={styles.label}>
        Ab
      </Text>
      <ScrollView ref={timesRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {slots.map((t) => (
          <Chip key={t} width={TIME_CHIP} label={time(new Date(t))} on={start === t} disabled={!!pending} onPress={() => setStart(t)} />
        ))}
      </ScrollView>

      <Text variant="bodyStrong" style={styles.label}>
        Wie lange?
      </Text>
      <View style={styles.wrap}>
        {durations.map((d) => (
          <Chip key={d} label={durationLabel(d)} on={minutes === d} disabled={!!pending} onPress={() => setMinutes(d)} />
        ))}
      </View>
      <View style={styles.stepper}>
        <Pressable accessibilityLabel="15 Minuten weniger" disabled={!!pending || minutes - 15 < s.minDurationMinutes} onPress={() => setMinutes((m) => m - 15)} style={styles.stepBtn} hitSlop={8}>
          <Ionicons name="remove" size={20} color={colors.ink} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="headline">{durationLabel(minutes)}</Text>
          {start ? (
            <Text variant="caption" tone="secondary">
              {time(new Date(start))} bis {dayLabel(new Date(start + minutes * 60_000)) === dayLabel(new Date(start)) ? '' : `${dayLabel(new Date(start + minutes * 60_000))} `}
              {time(new Date(start + minutes * 60_000))}
            </Text>
          ) : null}
        </View>
        <Pressable accessibilityLabel="15 Minuten mehr" disabled={!!pending || minutes + 15 > s.maxDurationMinutes} onPress={() => setMinutes((m) => m + 15)} style={styles.stepBtn} hitSlop={8}>
          <Ionicons name="add" size={20} color={colors.ink} />
        </Pressable>
      </View>

      {eventBlocked ? (
        <View style={[styles.event, { backgroundColor: colors.warningSoft }]}>
          <Ionicons name="ticket-outline" size={20} color={colors.warning} />
          <Text variant="callout" style={{ flex: 1 }}>
            {`${q!.event!.name}: Für dich buchbar ab ${dayLabel(new Date(q!.event!.yourAccessAt))} ${time(new Date(q!.event!.yourAccessAt))}. Mit höherem Status darfst du früher buchen.`}
          </Text>
        </View>
      ) : early ? (
        <View style={[styles.event, { backgroundColor: TIER[q!.tier].soft }]}>
          <Ionicons name="flash" size={20} color={TIER[q!.tier].color} />
          <Text variant="callout" style={{ flex: 1 }}>
            {`${q!.event!.name}: Vorkauf dank Status ${TIER[q!.tier].label}. Für alle erst ab ${dayLabel(new Date(q!.event!.publicOpenAt))} ${time(new Date(q!.event!.publicOpenAt))}.`}
          </Text>
        </View>
      ) : null}

      <View style={styles.price}>
        {quoteError ? (
          <Banner>{quoteError}</Banner>
        ) : !q ? (
          <>
            <Skeleton height={18} />
            <Skeleton height={18} width="60%" />
          </>
        ) : (
          <View style={{ gap: spacing.sm, opacity: quote.isFetching ? 0.5 : 1 }}>
            {q.lines.map((l) => (
              <View key={l.unit} style={styles.line}>
                <Text variant="callout" tone="secondary">
                  {l.unit === 'HOUR' ? `${durationLabel(Math.round(l.quantity * 60))}` : `${l.quantity} × ${{ DAY: 'Tag', WEEK: 'Woche', MONTH: 'Monat' }[l.unit]}`} à {money(l.unitPrice)}
                </Text>
                <Text variant="callout">{money(l.amount)}</Text>
              </View>
            ))}
            <View style={styles.line}>
              <Text variant="callout" tone="secondary">
                Servicegebühr ({pct(q.renterFeeBps)})
              </Text>
              <Text variant="callout">{money(q.renterFee)}</Text>
            </View>
            {q.tierSavings > 0 ? (
              <View style={styles.line}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name={TIER[q.tier].icon} size={14} color={TIER[q.tier].color} />
                  <Text variant="callout" style={{ color: TIER[q.tier].color }}>
                    Status {TIER[q.tier].label}: du sparst
                  </Text>
                </View>
                <Text variant="callout" style={{ color: TIER[q.tier].color }}>
                  −{money(q.tierSavings)}
                </Text>
              </View>
            ) : null}
            <Divider />
            <View style={styles.line}>
              <Text variant="headline">Total</Text>
              <Text variant="headline">{money(q.total, q.currency)}</Text>
            </View>
          </View>
        )}
      </View>

      <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
        <View style={styles.info}>
          <Ionicons name={s.instantBook ? 'flash-outline' : 'chatbubble-outline'} size={18} color={colors.accent} />
          <Text variant="callout" style={{ flex: 1 }}>
            {s.instantBook ? 'Sofort bestätigt nach der Zahlung.' : 'Der Vermieter bestätigt innert 24 Stunden. Sonst erhältst du automatisch alles zurück.'}
          </Text>
        </View>
        <View style={styles.info}>
          <Ionicons name="refresh-outline" size={18} color={colors.accent} />
          <Text variant="callout" style={{ flex: 1 }}>
            {!q
              ? CANCELLATION_LABEL[s.cancellationPolicy].text
              : new Date(q.freeCancellationUntil) > new Date()
                ? `Kostenlos stornierbar bis ${dayLabel(new Date(q.freeCancellationUntil))} ${time(new Date(q.freeCancellationUntil))}.`
                : `So kurzfristig nicht mehr kostenlos stornierbar (${CANCELLATION_LABEL[s.cancellationPolicy].text.replace('Kostenlos stornierbar ', '').replace(/\.$/, '')}).`}
          </Text>
        </View>
      </View>

      <Text variant="bodyStrong" style={styles.label}>
        Bezahlen mit
      </Text>
      <MethodPicker value={method} onChange={setMethod} disabled={busy} />

      {error ? (
        <View style={{ marginTop: spacing.lg }}>
          <Banner tone={pending ? 'info' : 'danger'}>{error}</Banner>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: spacing.xxl, marginBottom: spacing.sm },
  row: { gap: spacing.sm, paddingRight: spacing.xl },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minWidth: 64, alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, gap: 1 },
  chipOn: { backgroundColor: colors.primary },
  stepper: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, padding: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  event: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', padding: spacing.lg, borderRadius: radius.lg, marginTop: spacing.xl },
  price: { marginTop: spacing.xl, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.sm },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  info: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
});
