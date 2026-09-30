import { router } from 'expo-router';
import { EmptyState, Screen } from '@/ui';

export default function NotFound() {
  return (
    <Screen>
      <EmptyState
        icon="help-buoy-outline"
        title="Seite nicht gefunden"
        action={{ label: 'Zur Startseite', onPress: () => router.replace('/') }}
      />
    </Screen>
  );
}
