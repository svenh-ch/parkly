import { Image, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { APP_NAME } from '@/config/app';
import { Button, colors, radius, Screen, spacing, Text } from '@/ui';

const highlights = [
  { icon: 'map-outline', text: 'Parkhäuser und private Plätze auf einer Karte' },
  { icon: 'time-outline', text: 'Stunden, Tage oder Monate buchen' },
  { icon: 'cash-outline', text: 'Eigenen Parkplatz vermieten und verdienen' },
] as const;

export default function Welcome() {
  return (
    <Screen
      scroll={false}
      edges={['top', 'bottom']}
      footer={
        <View style={{ gap: spacing.md }}>
          <Button title="Konto erstellen" onPress={() => router.push('/register')} />
          <Button title="Ich habe bereits ein Konto" variant="ghost" onPress={() => router.push('/login')} />
        </View>
      }
    >
      <View style={styles.hero}>
        <Image
          source={require('@/assets/images/logo-mark.png')}
          style={styles.logo}
          accessibilityLabel="Logo"
        />
        <Text variant="display">{APP_NAME}</Text>
        <Text variant="headline" tone="secondary" style={{ fontWeight: '400' }}>
          Parken in der Schweiz. Finden, buchen, losfahren.
        </Text>
      </View>

      <View style={styles.list}>
        {highlights.map((h) => (
          <View key={h.icon} style={styles.item}>
            <View style={styles.itemIcon}>
              <Ionicons name={h.icon} size={20} color={colors.accent} />
            </View>
            <Text variant="body" style={{ flex: 1 }}>
              {h.text}
            </Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: spacing.huge, gap: spacing.md },
  logo: { width: 48, height: 70, resizeMode: 'contain', marginBottom: spacing.sm },
  list: { marginTop: spacing.huge, gap: spacing.xl },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  itemIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
