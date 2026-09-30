import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, typography } from '@/ui';

type IconName = ComponentProps<typeof Ionicons>['name'];

const tab = (title: string, icon: IconName, iconActive: IconName) => ({
  title,
  tabBarIcon: ({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) => (
    <Ionicons name={focused ? iconActive : icon} size={size - 2} color={color} />
  ),
});

/** Bottom Navigation. Vermieter-Bereiche kommen später als eigene Host-App/Dashboard dazu. */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inkTertiary,
        tabBarLabelStyle: { ...typography.micro, fontSize: 10, fontWeight: '500', letterSpacing: 0 },
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={tab('Home', 'home-outline', 'home')} />
      <Tabs.Screen name="map" options={tab('Karte', 'map-outline', 'map')} />
      <Tabs.Screen name="bookings" options={tab('Buchungen', 'calendar-outline', 'calendar')} />
      <Tabs.Screen name="host" options={tab('Vermieten', 'key-outline', 'key')} />
      <Tabs.Screen name="profile" options={tab('Profil', 'person-circle-outline', 'person-circle')} />
    </Tabs>
  );
}
