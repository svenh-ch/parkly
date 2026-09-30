import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import type { PlaceSuggestion } from '@parking/shared';
import { useLocation } from '@/features/location/LocationProvider';
import { clearRecent, loadRecent, saveRecent } from '@/features/search/recent';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { colors, Divider, radius, spacing, Text, typography } from '@/ui';

type IconName = ComponentProps<typeof Ionicons>['name'];
const iconFor: Record<PlaceSuggestion['type'], IconName> = {
  PARKING: 'car-outline',
  ADDRESS: 'location-outline',
  PLACE: 'map-outline',
  POI: 'storefront-outline',
};

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** "Wo möchtest du parken?": Ort, Adresse, Quartier oder Parkhaus suchen. */
export default function Search() {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const { coords, permission, request } = useLocation();
  const [text, setText] = useState('');
  const [recent, setRecent] = useState<PlaceSuggestion[]>([]);
  const q = useDebounced(text.trim(), 250);

  useEffect(() => {
    void loadRecent().then(setRecent);
  }, []);

  // Grobe Position (~1 km) nur für die Reihenfolge der Treffer
  const near = coords ? { lat: Number(coords.lat.toFixed(2)), lng: Number(coords.lng.toFixed(2)) } : null;
  const results = useQuery({
    queryKey: ['search', q, near?.lat, near?.lng],
    queryFn: ({ signal }) => api.search.places(q, signal, near),
    enabled: q.length >= 2,
    staleTime: 5 * 60_000,
  });

  const choose = async (item: PlaceSuggestion) => {
    Keyboard.dismiss();
    setRecent(await saveRecent(item));
    if (item.parking?.kind === 'PUBLIC_PARKING') {
      router.replace({ pathname: '/facility/[id]', params: { id: item.parking.id } });
      return;
    }
    if (item.parking?.kind === 'PRIVATE_MARKETPLACE_PARKING') {
      router.replace({ pathname: '/spot/[id]', params: { id: item.parking.id } });
      return;
    }
    showOnMap(item.lat, item.lng, item.label);
  };

  /** Zur Karte: Kamera-Flug zum Ort und "Parken bei …" */
  const showOnMap = (lat: number, lng: number, label: string) => {
    // Suche schliessen und zur Karte (kein neuer Stack-Eintrag bei jeder Suche)
    if (router.canGoBack()) router.back();
    router.navigate({
      pathname: '/map',
      params: { focusLat: String(lat), focusLng: String(lng), focusLabel: label, focusAt: String(Date.now()) },
    });
  };

  const goToMyLocation = async () => {
    if (!coords) {
      await request();
      return;
    }
    showOnMap(coords.lat, coords.lng, 'Mein Standort');
  };

  const showRecent = q.length < 2;
  const data = showRecent ? recent : (results.data ?? []);

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Zurück">
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </Pressable>
        <View style={styles.inputWrap}>
          <Ionicons name="search" size={18} color={colors.accent} />
          <TextInput
            ref={inputRef}
            autoFocus
            value={text}
            onChangeText={setText}
            placeholder="Ort, Adresse, Geschäft oder Parkhaus"
            placeholderTextColor={colors.inkTertiary}
            selectionColor={colors.accent}
            returnKeyType="search"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel="Wo möchtest du parken?"
          />
          {results.isFetching ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          {text ? (
            <Pressable onPress={() => setText('')} hitSlop={10} accessibilityLabel="Eingabe löschen">
              <Ionicons name="close-circle" size={18} color={colors.inkTertiary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={data}
        keyExtractor={(i) => i.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: insets.bottom + spacing.xl }}
        ItemSeparatorComponent={() => <Divider inset={44} />}
        ListHeaderComponent={
          showRecent ? (
            <View>
              <Pressable style={styles.row} onPress={() => void goToMyLocation()} accessibilityRole="button">
                <View style={[styles.icon, { backgroundColor: colors.accent }]}>
                  <Ionicons name="navigate" size={16} color={colors.onPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">Mein Standort</Text>
                  <Text variant="caption" tone="secondary">
                    {permission === 'granted' ? 'Parkplätze rund um dich' : 'Standort erlauben'}
                  </Text>
                </View>
              </Pressable>
              {recent.length ? (
                <View style={styles.sectionHead}>
                  <Text variant="captionStrong" tone="secondary">
                    ZULETZT GESUCHT
                  </Text>
                  <Pressable
                    onPress={() => {
                      void clearRecent();
                      setRecent([]);
                    }}
                    hitSlop={10}
                  >
                    <Text variant="captionStrong" style={{ color: colors.accent }}>
                      Löschen
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null
        }
        ListFooterComponent={
          !showRecent && data.length ? (
            <Text variant="caption" tone="tertiary" style={{ paddingTop: spacing.lg }}>
              Orte: © swisstopo · © OpenStreetMap-Mitwirkende (openrouteservice)
            </Text>
          ) : null
        }
        ListEmptyComponent={
          showRecent ? null : results.isError ? (
            <Text variant="callout" tone="danger" style={styles.message}>
              {userMessage(results.error)}
            </Text>
          ) : results.isFetching ? null : (
            <Text variant="callout" tone="secondary" style={styles.message}>
              Keine Treffer für «{q}». Versuche es mit einer Strasse oder einem Ort.
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
            onPress={() => void choose(item)}
            accessibilityRole="button"
          >
            <View style={[styles.icon, (item.type === 'PARKING' || item.type === 'POI') && { backgroundColor: colors.accentSoft }]}>
              <Ionicons name={showRecent ? 'time-outline' : iconFor[item.type]} size={18} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="body" numberOfLines={1}>
                {item.label}
              </Text>
              {item.detail || item.type === 'PARKING' || item.type === 'POI' ? (
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                  {item.type === 'PARKING'
                    ? ['Parkhaus', item.detail].filter(Boolean).join(' · ')
                    : item.type === 'POI'
                      ? ['Ort', item.detail].filter(Boolean).join(' · ')
                      : item.detail}
                </Text>
              ) : null}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
  },
  input: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 60, paddingVertical: spacing.sm },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.xs },
  message: { paddingVertical: spacing.xl },
});
