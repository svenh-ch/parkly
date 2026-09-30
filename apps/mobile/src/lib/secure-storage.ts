import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Speicher für die Auth-Session.
 *
 * iOS/Android: Keychain bzw. Keystore (expo-secure-store). Einzelne Einträge sollten klein
 * bleiben; Supabase-Sessions können grösser sein, darum wird der Wert in Stücke aufgeteilt.
 * Web: localStorage (nur für die spätere Web-App; dort gelten Browser-Sicherheitsregeln).
 */

const CHUNK_SIZE = 1800;
const countKey = (key: string) => `${key}.n`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

async function removeChunks(key: string, from = 0) {
  const n = Number((await SecureStore.getItemAsync(countKey(key), options)) ?? 0);
  for (let i = from; i < n; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, i), options);
  }
}

const nativeStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = await SecureStore.getItemAsync(countKey(key), options);
    if (count === null) return null;
    const parts: string[] = [];
    for (let i = 0; i < Number(count); i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i), options);
      if (part === null) return null; // unvollständig -> als abgemeldet behandeln
      parts.push(part);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    const chunks = value.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}`, 'g')) ?? [''];
    const previous = Number((await SecureStore.getItemAsync(countKey(key), options)) ?? 0);
    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(chunkKey(key, i), chunks[i]!, options);
    }
    await SecureStore.setItemAsync(countKey(key), String(chunks.length), options);
    for (let i = chunks.length; i < previous; i++) {
      await SecureStore.deleteItemAsync(chunkKey(key, i), options);
    }
  },
  async removeItem(key: string): Promise<void> {
    await removeChunks(key);
    await SecureStore.deleteItemAsync(countKey(key), options);
  },
};

const webStorage = {
  getItem: async (key: string) => globalThis.localStorage?.getItem(key) ?? null,
  setItem: async (key: string, value: string) => globalThis.localStorage?.setItem(key, value),
  removeItem: async (key: string) => globalThis.localStorage?.removeItem(key),
};

export const secureSessionStorage = Platform.OS === 'web' ? webStorage : nativeStorage;
