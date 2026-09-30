import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Booking } from '@parking/shared';
import { Ticket } from '@/features/bookings/Ticket';
import { dayLabel, durationLabel, money, time } from '@/features/bookings/format';
import { useBooking, useBookingCache } from '@/features/bookings/queries';
import { cancelEndReminder, scheduleEndReminder } from '@/features/bookings/reminders';
import { usePay, usePayMethod } from '@/features/payments/usePay';
import { openInAppRoute } from '@/features/route/open';
import { api } from '@/lib/api';
import { confirm, notify } from '@/lib/confirm';
import { userMessage } from '@/lib/errors';
import { Banner, Button, colors, ErrorState, radius, Screen, SectionTitle, Skeleton, spacing, Text } from '@/ui';

const EXTEND = [15, 30, 60, 120];

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function phaseText(b: Booking, now: Date) {
  const s = new Date(b.startAt).getTime();
  const e = new Date(b.endAt).getTime();
  const t = now.getTime();
  if (b.status === 'PENDING_APPROVAL') return b.approvalDeadline ? `Der Vermieter antwortet bis ${dayLabel(new Date(b.approvalDeadline))} ${time(new Date(b.approvalDeadline))}.` : 'Wartet auf den Vermieter.';
  if (b.status !== 'CONFIRMED') return null;
  if (t < s) return `Beginnt in ${durationLabel(Math.max(1, Math.round((s - t) / 60_000)))}`;
  if (t < e) return `Läuft · noch ${durationLabel(Math.max(1, Math.round((e - t) / 60_000)))}`;
  return 'Beendet';
}

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useBooking(id);
  const cache = useBookingCache();
  const { pay, paying } = usePay();
  const [method] = usePayMethod();
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.data) void scheduleEndReminder(q.data);
  }, [q.data]);

  if (q.isPending) {
    return (
      <Screen edges={['bottom']}>
        <Skeleton height={320} rounded={radius.xl} />
      </Screen>
    );
  }
  if (q.isError) return <ErrorState message={userMessage(q.error)} onRetry={() => void q.refetch()} />;
  const b = q.data;
  const isHost = b.role === 'HOST';

  const run = async (key: string, fn: () => Promise<void>) => {
    setError(null);
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error && !('status' in e) ? e.message : userMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const extend = (minutes: number) =>
    run(`extend-${minutes}`, async () => {
      const res = await api.bookings.extend(b.id, minutes);
      const ok = await confirm(
        `Um ${durationLabel(minutes)} verlängern?`,
        res.quote.total > 0
          ? `Neues Ende: ${time(new Date(res.quote.endAt))}. Kosten: ${money(res.quote.total, res.quote.currency)}.`
          : `Neues Ende: ${time(new Date(res.quote.endAt))}. Kostet nichts extra.`,
        res.quote.total > 0 ? (method === 'twint' ? 'Mit TWINT bezahlen' : 'Bezahlen') : 'Verlängern',
      );
      if (!ok) return;
      let updated: Booking | null = res.booking;
      if (res.payment) {
        const before = b.endAt;
        updated = await pay(b.id, res.payment, method, (x) => x.endAt !== before);
        if (!updated) return;
        if (updated.endAt === before) throw new Error('Der Platz ist danach leider schon gebucht. Du erhältst den Betrag zurück.');
      }
      cache(updated);
      router.push({ pathname: '/booking/success', params: { id: b.id, kind: 'extended' } });
    });

  const cancel = () =>
    run('cancel', async () => {
      const p = await api.bookings.cancelPreview(b.id);
      const ok = await confirm(
        'Buchung stornieren?',
        p.refund > 0 ? `Du erhältst ${money(p.refund, b.currency)} zurück (in der Regel innert 5–10 Tagen).` : 'Die kostenlose Stornofrist ist vorbei. Es gibt keine Rückerstattung.',
        'Stornieren',
        true,
      );
      if (!ok) return;
      const updated = await api.bookings.cancel(b.id);
      await cancelEndReminder(b.id);
      cache(updated);
    });

  const hostAction = (kind: 'accept' | 'decline' | 'cancel') =>
    run(kind, async () => {
      if (kind !== 'accept') {
        const ok = await confirm(
          kind === 'decline' ? 'Anfrage ablehnen?' : 'Buchung stornieren?',
          'Der Mieter erhält den vollen Betrag zurück. Häufige Absagen können zu einer Sperre führen.',
          kind === 'decline' ? 'Ablehnen' : 'Stornieren',
          true,
        );
        if (!ok) return;
      }
      const updated = kind === 'accept' ? await api.hostBookings.accept(b.id) : kind === 'decline' ? await api.hostBookings.decline(b.id) : await api.hostBookings.cancel(b.id);
      cache(updated);
      if (kind === 'accept') notify('Bestätigt', 'Der Mieter erhält jetzt die Adresse und die Zugangsinfos.');
    });

  const phase = phaseText(b, now);
  const running = b.status === 'CONFIRMED' && new Date(b.startAt) <= now && new Date(b.endAt) > now;

  return (
    <Screen edges={['bottom']} onRefresh={() => void q.refetch()} refreshing={q.isRefetching} contentStyle={{ backgroundColor: colors.surface, flexGrow: 1 }}>
      <Stack.Screen options={{ title: isHost ? 'Buchung (Vermieter)' : 'Deine Buchung', contentStyle: { backgroundColor: colors.surface } }} />
      {phase ? (
        <View style={[styles.phase, running && { backgroundColor: colors.successSoft }]}>
          <Ionicons name={running ? 'time' : 'time-outline'} size={18} color={running ? colors.success : colors.inkSecondary} />
          <Text variant="bodyStrong" style={{ color: running ? colors.success : colors.ink }}>
            {phase}
          </Text>
        </View>
      ) : null}
      <Ticket b={b} />
      {error ? (
        <View style={{ marginTop: spacing.lg }}>
          <Banner>{error}</Banner>
        </View>
      ) : null}

      {!isHost && b.spot.address && (b.status === 'CONFIRMED' || b.status === 'COMPLETED') ? (
        <Button title="Route starten" icon="navigate" style={{ marginTop: spacing.xl }} onPress={() => openInAppRoute({ lat: b.spot.lat, lng: b.spot.lng, name: b.spot.title })} />
      ) : null}

      {b.canExtend ? (
        <>
          <SectionTitle>Parken verlängern</SectionTitle>
          <View style={styles.extend}>
            {EXTEND.map((m) => (
              <Button key={m} title={`+ ${durationLabel(m)}`} size="md" variant="secondary" fullWidth={false} style={{ flexGrow: 1 }} loading={busy === `extend-${m}` || (paying && busy === `extend-${m}`)} disabled={!!busy} onPress={() => void extend(m)} />
            ))}
          </View>
          <Text variant="caption" tone="tertiary" style={{ marginTop: spacing.sm }}>
            Nur möglich, wenn der Platz danach frei ist.
          </Text>
        </>
      ) : null}

      {isHost && b.status === 'PENDING_APPROVAL' ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
          <Button title="Anfrage annehmen" icon="checkmark" loading={busy === 'accept'} disabled={!!busy} onPress={() => void hostAction('accept')} />
          <Button title="Ablehnen" variant="danger" loading={busy === 'decline'} disabled={!!busy} onPress={() => void hostAction('decline')} />
        </View>
      ) : null}

      {b.canCancel ? (
        <Button
          title="Buchung stornieren"
          variant="ghost"
          style={{ marginTop: spacing.xxl }}
          loading={busy === 'cancel'}
          disabled={!!busy}
          onPress={() => void (isHost ? hostAction('cancel') : cancel())}
        />
      ) : null}
      {!isHost && b.canCancel ? (
        <Text variant="caption" tone="tertiary" align="center">
          {new Date(b.freeCancellationUntil) > now
            ? `Kostenlos bis ${dayLabel(new Date(b.freeCancellationUntil))} ${time(new Date(b.freeCancellationUntil))}`
            : 'Die kostenlose Stornofrist ist vorbei.'}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  phase: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start', backgroundColor: colors.background, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.lg, marginTop: spacing.md },
  extend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
