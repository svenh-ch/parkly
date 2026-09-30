import { Alert, Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { APP_NAME, SUPPORT_EMAIL } from '@/config/app';
import { useAuth } from '@/features/auth/AuthProvider';
import { displayName, useDeleteAccount, useMe } from '@/features/profile/queries';
import { TIER } from '@/features/bookings/format';
import { useLoyalty } from '@/features/bookings/queries';
import { userMessage } from '@/lib/errors';
import { Avatar, Divider, ErrorState, ListRow, Screen, SectionTitle, Skeleton, spacing, Text } from '@/ui';

export default function Profile() {
  const me = useMe();
  const { signOut } = useAuth();
  const deleteAccount = useDeleteAccount();
  const loyalty = useLoyalty();

  const confirmSignOut = () =>
    Alert.alert('Abmelden?', undefined, [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Abmelden', style: 'destructive', onPress: () => void signOut() },
    ]);

  const confirmDelete = () =>
    Alert.alert(
      'Konto löschen?',
      'Deine persönlichen Daten werden gelöscht. Buchungsbelege bleiben gemäss gesetzlicher Aufbewahrungspflicht anonymisiert erhalten. Dies kann nicht rückgängig gemacht werden.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Endgültig löschen',
          style: 'destructive',
          onPress: () =>
            deleteAccount.mutate(undefined, {
              onError: (e) => Alert.alert('Löschen nicht möglich', userMessage(e)),
            }),
        },
      ],
    );

  return (
    <Screen onRefresh={() => void me.refetch()} refreshing={me.isRefetching}>
      <View style={styles.header}>
        {me.isPending ? (
          <>
            <Skeleton width={64} height={64} rounded={32} />
            <View style={{ gap: spacing.sm, flex: 1 }}>
              <Skeleton width="60%" height={22} />
              <Skeleton width="80%" height={14} />
            </View>
          </>
        ) : me.isError ? null : (
          <>
            <Avatar name={displayName(me.data)} size={64} />
            <View style={{ flex: 1 }}>
              <Text variant="title" numberOfLines={1}>
                {displayName(me.data)}
              </Text>
              <Text variant="callout" tone="secondary" numberOfLines={1}>
                {me.data.email}
              </Text>
            </View>
          </>
        )}
      </View>

      {me.isError ? <ErrorState message={userMessage(me.error)} onRetry={() => void me.refetch()} /> : null}

      <SectionTitle>Parkly Status</SectionTitle>
      <ListRow
        icon={loyalty.data ? TIER[loyalty.data.tier].icon : 'medal-outline'}
        title={loyalty.data ? `Status ${TIER[loyalty.data.tier].label}` : 'Status'}
        subtitle={
          loyalty.data
            ? loyalty.data.next
              ? `${loyalty.data.points} Punkte · noch ${loyalty.data.pointsToNext} bis ${TIER[loyalty.data.next.tier].label}`
              : `${loyalty.data.points} Punkte · höchste Stufe`
            : 'Weniger Gebühren und Vorkauf bei Events'
        }
        onPress={() => router.push('/loyalty')}
      />

      <SectionTitle>Konto</SectionTitle>
      <ListRow icon="person-circle-outline" title="Kontoübersicht" subtitle="Alle deine Daten auf einen Blick" onPress={() => router.push('/account')} />
      <Divider inset={38} />
      <ListRow icon="person-outline" title="Persönliche Daten bearbeiten" onPress={() => router.push('/profile/edit')} />
      <Divider inset={38} />
      <ListRow icon="card-outline" title="Zahlungsmethoden" badge="Bald" disabled />
      <Divider inset={38} />
      <ListRow icon="heart-outline" title="Favoriten" onPress={() => router.push('/favorites')} />

      <SectionTitle>Aktivität</SectionTitle>
      <ListRow icon="calendar-outline" title="Meine Buchungen" onPress={() => router.push('/bookings')} />
      <Divider inset={38} />
      <ListRow icon="key-outline" title="Meine Parkplätze" onPress={() => router.push('/host')} />
      <Divider inset={38} />
      <ListRow icon="star-outline" title="Meine Bewertungen" onPress={() => router.push('/my-reviews')} />

      <SectionTitle>Support</SectionTitle>
      <ListRow icon="help-circle-outline" title="Hilfe & Kontakt" onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
      <Divider inset={38} />
      <ListRow icon="log-out-outline" title="Abmelden" onPress={confirmSignOut} showChevron={false} />
      <Divider inset={38} />
      <ListRow icon="trash-outline" title="Konto löschen" destructive onPress={confirmDelete} showChevron={false} />

      <Text variant="caption" tone="tertiary" align="center" style={{ marginTop: spacing.xxl }}>
        {APP_NAME} · Version {Constants.expoConfig?.version ?? '–'}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingTop: spacing.xxl, minHeight: 100 },
});
