import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlaceSuggestion } from '@parking/shared';

/** Zuletzt gesuchte Orte, nur lokal auf dem Gerät gespeichert. */
const KEY = 'parkly.recentSearches.v1';
const MAX = 8;

export async function loadRecent(): Promise<PlaceSuggestion[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlaceSuggestion[]) : [];
  } catch {
    return [];
  }
}

export async function saveRecent(item: PlaceSuggestion): Promise<PlaceSuggestion[]> {
  const current = await loadRecent();
  const next = [item, ...current.filter((c) => c.id !== item.id)].slice(0, MAX);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* Speichern ist optional */
  }
  return next;
}

export async function clearRecent(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignorieren */
  }
}
