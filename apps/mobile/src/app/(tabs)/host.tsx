import { useState, type ComponentProps } from 'react';
import { Alert, Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { HostSpotListItem } from '@parking/shared';
import { chf, ISSUE_LABEL, STATUS_LABEL } from '@/features/host/labels';
import { useHostSpots, useSpotAction } from '@/features/host/queries';
import { mediaUrl } from '@/lib/media';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMe } from '@/features/profile/queries';
import { useHostBookings } from '@/features/bookings/queries';
import { userMessage } from '@/lib/errors';
import {
  Badge,
  Button,
  Card,
  colors,
  EmptyState,
  ErrorState,
  radius,
  Screen,
  ScreenHeader,
  Skeleton,
  spacing,
  Text,
} from '@/ui';

const steps: { icon: ComponentProps<typeof Ionicons>['name']; title: string; text: string }[] = [
  { icon: 'camera-outline', title: 'Inserat erstellen', text: 'Adresse, Fotos, Preis und Verfügbarkeit in wenigen Minuten.' },
  { icon: 'calendar-outline', title: 'Buchungen erhalten', text: 'Mieter buchen und bezahlen direkt in der App.' },
  { icon: 'wallet-outline', title: 'Auszahlung', text: 'Der Betrag abzüglich Plattformgebühr geht auf dein Konto.' },
];

export default function HostTab() {
  const me = useMe();

  if (me.isPending) {
    return (
      <Screen>
        <ScreenHeader title="Vermieten" />
        <Skeleton height={180} rounded={radius.lg} />
      </Screen>
    );
  }
  if (me.isError) {
    return (
      <Screen>
        <ScreenHeader title="Vermieten" />
        <ErrorState message={userMessage(me.error)} onRetry={() => void me.refetch()} />
      </Screen>
    );
  }

  const isHost = me.data.roles.includes('HOST');

  if (!isHost) {
    return (
      <Screen footer={<Button title="Vermieter werden" onPress={() => router.push('/host/become')} />}>
        <ScreenHeader title="Vermieten" subtitle="Dein Parkplatz steht oft leer? Verdiene damit Geld." />
        <View style={{ gap: spacing.md }}>
          {steps.map((s) => (
            <Card key={s.title} style={styles.step}>
              <View style={styles.stepIcon}>
                <Ionicons name={s.icon} size={22} color={colors.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{s.title}</Text>
                <Text variant="callout" tone="secondary">
                  {s.text}
                </Text>
              </View>
            </Card>
          ))}
        </View>
      </Screen>
    );
  }

  return <MySpots />;
}

function MySpots() {
  const list = useHostSpots();
  const hostBookings = useHostBookings();
  const requests = (hostBookings.data ?? []).filter((b) => b.status === 'PENDING_APPROVAL').length;
  const actions = useSpotAction();
  const [busy, setBusy] = useState<string | null>(null);

  const confirmDelete = (spot: HostSpotListItem) => {
    const run = async () => {
      setBusy(spot.id);
      try {
        await actions.remove.mutateAsync(spot.id);
      } catch (e) {
        const msg = userMessage(e);
        if (Platform.OS === 'web') globalThis.alert?.(msg);
        else Alert.alert('Nicht möglich', msg);
      } finally {
        setBusy(null);
      }
    };
    if (Platform.OS === 'web') void run();
    else
      Alert.alert('Parkplatz löschen?', `«${spot.title}» wird mit allen Fotos gelöscht.`, [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Löschen', style: 'destructive', onPress: () => void run() },
      ]);
  };

  const toggle = async (spot: HostSpotListItem) => {
    setBusy(spot.id);
    try {
      if (spot.status === 'ACTIVE') await actions.pause.mutateAsync(spot.id);
      else await actions.publish.mutateAsync(spot.id);
    } catch (e) {
      const msg = userMessage(e);
      if (Platform.OS === 'web') globalThis.alert?.(msg);
      else Alert.alert('Nicht möglich', msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
      footer={<Button title="Parkplatz inserieren" icon="add" onPress={() => router.push({ pathname: '/host/spot/[id]', params: { id: 'new' } })} />}
    >
      <ScreenHeader title="Meine Parkplätze" right={<Badge label="Vermieter" tone="primary" />} />
      <View style={styles.shortcuts}>
        <Pressable style={styles.shortcut} onPress={() => router.push('/host/bookings')} accessibilityRole="button">
          <Ionicons name="calendar-outline" size={22} color={colors.accent} />
          <Text variant="bodyStrong">Buchungen</Text>
          {requests ? (
            <View style={styles.dot}>
              <Text variant="micro" style={{ color: colors.onPrimary }}>
                {requests}
              </Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable style={styles.shortcut} onPress={() => router.push('/host/payouts')} accessibilityRole="button">
          <Ionicons name="wallet-outline" size={22} color={colors.accent} />
          <Text variant="bodyStrong">Auszahlungen</Text>
        </Pressable>
      </View>
      {list.isPending ? (
        <Skeleton height={120} rounded={radius.lg} />
      ) : list.isError ? (
        <ErrorState message={userMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState
          icon="add-circle-outline"
          title="Noch keine Parkplätze"
          message="Inseriere deinen ersten Parkplatz: Adresse, Fotos, Preis und Verfügbarkeit in wenigen Minuten."
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {list.data.map((spot) => (
            <Card key={spot.id} style={styles.spotCard}>
              <Pressable
                style={styles.spotRow}
                onPress={() => router.push({ pathname: '/host/spot/[id]', params: { id: spot.id } })}
                accessibilityRole="button"
              >
                {spot.coverUrl ? (
                  <Image source={{ uri: mediaUrl(spot.coverUrl) }} style={styles.cover} />
                ) : (
                  <View style={[styles.cover, styles.coverEmpty]}>
                    <Ionicons name="image-outline" size={24} color={colors.inkTertiary} />
                  </View>
                )}
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {spot.title}
                  </Text>
                  <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {spot.address.street} {spot.address.houseNumber ?? ''}, {spot.address.city}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                    <Badge label={STATUS_LABEL[spot.status]} tone={spot.status === 'ACTIVE' ? 'primary' : spot.status === 'DRAFT' ? 'warning' : 'neutral'} />
                    <Text variant="caption" tone="secondary">
                      {headline(spot)}
                    </Text>
                  </View>
                </View>
              </Pressable>
              {spot.status === 'DRAFT' && spot.publishIssues.length ? (
                <Text variant="caption" tone="secondary">
                  Noch offen: {spot.publishIssues.map((i) => ISSUE_LABEL[i]).join(', ')}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <Button title="Bearbeiten" size="md" variant="secondary" fullWidth={false} icon="create-outline" onPress={() => router.push({ pathname: '/host/spot/[id]', params: { id: spot.id } })} />
                {spot.status === 'ACTIVE' || spot.status === 'PAUSED' ? (
                  <Button
                    title={spot.status === 'ACTIVE' ? 'Pausieren' : 'Aktivieren'}
                    size="md"
                    variant="secondary"
                    fullWidth={false}
                    icon={spot.status === 'ACTIVE' ? 'pause-outline' : 'play-outline'}
                    loading={busy === spot.id}
                    onPress={() => void toggle(spot)}
                  />
                ) : null}
                {spot.status === 'ACTIVE' ? (
                  <Button title="Ansehen" size="md" variant="ghost" fullWidth={false} onPress={() => router.push({ pathname: '/spot/[id]', params: { id: spot.id } })} />
                ) : null}
                <Button title="Löschen" size="md" variant="ghost" fullWidth={false} icon="trash-outline" onPress={() => confirmDelete(spot)} disabled={busy === spot.id} />
              </View>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

function headline(spot: HostSpotListItem) {
  const p = spot.prices;
  if (p.hourly) return `CHF ${chf(p.hourly)}/Std.`;
  if (p.daily) return `CHF ${chf(p.daily)}/Tag`;
  if (p.weekly) return `CHF ${chf(p.weekly)}/Woche`;
  if (p.monthly) return `CHF ${chf(p.monthly)}/Monat`;
  return `${spot.imageCount} Fotos`;
}

const styles = StyleSheet.create({
  shortcuts: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl },
  shortcut: { flex: 1, gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  dot: { position: 'absolute', top: spacing.md, right: spacing.md, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  spotCard: { gap: spacing.md },
  spotRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  cover: { width: 72, height: 72, borderRadius: radius.md },
  coverEmpty: { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  step: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  stepIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
