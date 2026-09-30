import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Booking } from '@parking/shared';
import { ACCESS_LABEL } from '@/features/host/labels';
import { colors, radius, shadows, spacing, Text } from '@/ui';
import { BOOKING_STATUS, dayLabel, durationLabel, money, time } from './format';

function Row({ icon, label, value }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={colors.accent} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text variant="caption" tone="secondary">
          {label}
        </Text>
        <Text variant="callout">{value}</Text>
      </View>
    </View>
  );
}

/** Buchungsbeleg im Ticket-Look: Zeitraum, Ort, Zugang, Betrag. */
export function Ticket({ b }: { b: Booking }) {
  const s = new Date(b.startAt);
  const e = new Date(b.endAt);
  const st = BOOKING_STATUS[b.status];
  const minutes = Math.round((e.getTime() - s.getTime()) / 60_000);
  return (
    <View style={[styles.ticket, shadows.card]}>
      <View style={styles.top}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="micro" tone="secondary">
            PARKLY TICKET
          </Text>
          <View style={[styles.pill, { backgroundColor: st.bg }]}>
            <Text variant="micro" style={{ color: st.color }}>
              {st.label.toUpperCase()}
            </Text>
          </View>
        </View>
        <Text variant="headline" numberOfLines={2}>
          {b.spot.title}
        </Text>
        <View style={styles.times}>
          <View>
            <Text variant="caption" tone="secondary">
              {dayLabel(s)}
            </Text>
            <Text variant="title">{time(s)}</Text>
          </View>
          <View style={{ alignItems: 'center', flex: 1 }}>
            <Ionicons name="arrow-forward" size={18} color={colors.inkTertiary} />
            <Text variant="caption" tone="tertiary">
              {durationLabel(minutes)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="caption" tone="secondary">
              {dayLabel(e)}
            </Text>
            <Text variant="title">{time(e)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.tear}>
        <View style={[styles.notch, { left: -12 }]} />
        <View style={styles.dash} />
        <View style={[styles.notch, { right: -12 }]} />
      </View>

      <View style={styles.bottom}>
        <Row icon="location-outline" label="Adresse" value={b.spot.address ?? `${b.spot.area} (genaue Adresse nach der Bestätigung)`} />
        {b.spot.floor || b.spot.spotNumber ? (
          <Row icon="layers-outline" label="Platz" value={[b.spot.floor ? `Stockwerk ${b.spot.floor}` : null, b.spot.spotNumber ? `Nr. ${b.spot.spotNumber}` : null].filter(Boolean).join(' · ')} />
        ) : null}
        <Row icon="key-outline" label="Zugang" value={b.spot.accessInstructions ?? ACCESS_LABEL[b.spot.accessMethod as keyof typeof ACCESS_LABEL] ?? 'Siehe Beschreibung'} />
        <Row icon="card-outline" label={b.role === 'HOST' ? 'Deine Einnahmen' : 'Bezahlt'} value={money(b.role === 'HOST' ? b.hostPayout : b.total, b.currency)} />
        {b.refundedAmount > 0 ? <Row icon="return-down-back-outline" label="Erstattet" value={money(b.refundedAmount, b.currency)} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ticket: { backgroundColor: colors.background, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  top: { padding: spacing.xl, gap: spacing.md },
  times: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  tear: { height: 24, justifyContent: 'center' },
  dash: { marginHorizontal: spacing.xl, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong },
  notch: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surface, top: 0 },
  bottom: { padding: spacing.xl, paddingTop: spacing.sm, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
});
