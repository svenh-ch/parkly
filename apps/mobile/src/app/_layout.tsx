import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';
import { router, Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { handleRecoveryLink } from '@/features/auth/recovery-link';
import { onReminderTap } from '@/features/bookings/reminders';
import { LocationProvider } from '@/features/location/LocationProvider';
import { envError } from '@/lib/env';
import { queryClient } from '@/lib/query-client';
import { colors, EmptyState, Screen } from '@/ui';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <LocationProvider>
              <StatusBar style="dark" />
              {envError ? <ConfigError message={envError} /> : <RootNavigator />}
            </LocationProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { status, isRecovering } = useAuth();
  const signedIn = status === 'signedIn';

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  // Deep Link aus der "Passwort zurücksetzen"-E-Mail
  useEffect(() => {
    const open = (url: string | null) =>
      handleRecoveryLink(url)
        .then((ok) => ok && router.replace('/reset-password'))
        .catch(() => router.replace({ pathname: '/reset-password', params: { expired: '1' } }));
    void Linking.getInitialURL().then(open);
    const sub = Linking.addEventListener('url', ({ url }) => void open(url));
    return () => sub.remove();
  }, []);

  // Tipp auf "Parkzeit endet bald" öffnet die Buchung
  useEffect(() => (signedIn ? onReminderTap((id) => router.push({ pathname: '/booking/[id]', params: { id } })) : undefined), [signedIn]);

  if (status === 'loading') return null; // Splash bleibt sichtbar

  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.ink,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={signedIn && !isRecovering}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="profile/edit" options={{ title: 'Persönliche Daten' }} />
        <Stack.Screen name="host/become" options={{ title: '', presentation: 'modal' }} />
        <Stack.Screen name="facility/[id]" options={{ title: '' }} />
        <Stack.Screen name="review/facility/[id]" options={{ title: '', presentation: 'modal' }} />
        <Stack.Screen name="favorites" options={{ title: 'Favoriten' }} />
        <Stack.Screen name="my-reviews" options={{ title: 'Meine Bewertungen' }} />
        <Stack.Screen name="account" options={{ title: 'Konto' }} />
        <Stack.Screen name="search" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="place" options={{ title: '' }} />
        <Stack.Screen name="route" options={{ headerShown: false }} />
        <Stack.Screen name="spot/[id]" options={{ title: '' }} />
        <Stack.Screen name="host/spot/[id]" options={{ title: 'Parkplatz inserieren' }} />
        <Stack.Screen name="admin/tariffs/[id]" options={{ title: 'Tarife', presentation: 'modal' }} />
        <Stack.Screen name="book/[spotId]" options={{ title: 'Buchen' }} />
        <Stack.Screen name="booking/success" options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="booking/[id]" options={{ title: 'Deine Buchung' }} />
        <Stack.Screen name="loyalty" options={{ title: 'Parkly Status' }} />
        <Stack.Screen name="host/bookings" options={{ title: 'Buchungen meiner Plätze' }} />
        <Stack.Screen name="host/payouts" options={{ title: 'Auszahlungen' }} />
      </Stack.Protected>

      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Screen name="reset-password" options={{ title: 'Neues Passwort' }} />
    </Stack>
  );
}

function ConfigError({ message }: { message: string }) {
  useEffect(() => void SplashScreen.hideAsync(), []);
  return (
    <Screen>
      <EmptyState
        icon="construct-outline"
        title="Konfiguration unvollständig"
        message={`${message}\n\nSiehe apps/mobile/.env.example`}
      />
    </Screen>
  );
}
