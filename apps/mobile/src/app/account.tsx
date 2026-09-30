import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Me } from '@parking/shared';
import { displayName, useMe } from '@/features/profile/queries';
import { userMessage } from '@/lib/errors';
import { Avatar, Badge, Button, colors, Divider, ErrorState, radius, Screen, SectionTitle, Skeleton, spacing, Text } from '@/ui';

const dateFmt = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'long', year: 'numeric' });

const roleLabel: Record<string, string> = { RENTER: 'Mieter', HOST: 'Vermieter', ADMIN: 'Admin' };
const onboardingLabel: Record<string, string> = {
  NOT_STARTED: 'Noch nicht eingerichtet',
  PENDING: 'In Prüfung',
  COMPLETE: 'Aktiv',
  RESTRICTED: 'Eingeschränkt',
};

export default function Account() {
  const me = useMe();
  if (me.isPending) {
    return (
      <Screen edges={['bottom']} contentStyle={{ gap: spacing.lg, paddingTop: spacing.xl }}>
        <Skeleton height={80} rounded={radius.lg} />
        <Skeleton height={220} rounded={radius.lg} />
      </Screen>
    );
  }
  if (me.isError) return <ErrorState message={userMessage(me.error)} onRetry={() => void me.refetch()} />;
  return <AccountView me={me.data} />;
}

function AccountView({ me }: { me: Me }) {
  const name = displayName(me);
  return (
    <Screen
      edges={['bottom']}
      footer={<Button title="Persönliche Daten bearbeiten" icon="create-outline" onPress={() => router.push('/profile/edit')} />}
    >
      <View style={styles.head}>
        <Avatar name={name} size={72} />
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text variant="title" numberOfLines={1}>
            {name}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
            {me.roles.map((r) => (
              <Badge key={r} label={roleLabel[r] ?? r} tone={r === 'HOST' ? 'primary' : 'neutral'} />
            ))}
          </View>
        </View>
      </View>

      <SectionTitle>Persönliche Daten</SectionTitle>
      <Row icon="person-outline" label="Vorname" value={me.firstName} />
      <Divider inset={38} />
      <Row icon="person-outline" label="Nachname" value={me.lastName} />
      <Divider inset={38} />
      <Row icon="mail-outline" label="E-Mail" value={me.email} />
      <Divider inset={38} />
      <Row icon="call-outline" label="Telefon" value={me.phone} />
      <Divider inset={38} />
      <Row icon="calendar-outline" label="Mitglied seit" value={dateFmt.format(new Date(me.createdAt))} />
      <Divider inset={38} />
      <Row
        icon="document-text-outline"
        label="AGB akzeptiert"
        value={me.termsAcceptedAt ? dateFmt.format(new Date(me.termsAcceptedAt)) : null}
      />

      <SectionTitle>Vermieterprofil</SectionTitle>
      {me.hostProfile ? (
        <>
          <Row icon="storefront-outline" label="Anzeigename" value={me.hostProfile.displayName} />
          <Divider inset={38} />
          <Row icon="calendar-outline" label="Vermieter seit" value={dateFmt.format(new Date(me.hostProfile.since))} />
          <Divider inset={38} />
          <Row icon="wallet-outline" label="Auszahlungen" value={onboardingLabel[me.hostProfile.onboardingStatus] ?? null} />
        </>
      ) : (
        <View style={styles.hostEmpty}>
          <Text variant="callout" tone="secondary" style={{ flex: 1 }}>
            Du vermietest noch keinen Parkplatz.
          </Text>
          <Button title="Vermieter werden" size="md" variant="secondary" fullWidth={false} onPress={() => router.push('/host/become')} />
        </View>
      )}
    </Screen>
  );
}

function Row({ icon, label, value }: { icon: ComponentProps<typeof Ionicons>['name']; label: string; value: string | null }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={colors.inkSecondary} />
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="callout" tone={value ? 'default' : 'tertiary'} style={{ maxWidth: '55%', textAlign: 'right' }} numberOfLines={1}>
        {value ?? 'Nicht angegeben'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingTop: spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, minHeight: 52 },
  hostEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
});
