import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import { secureSessionStorage } from './secure-storage';

/**
 * Supabase wird in der App ausschliesslich für die Authentifizierung verwendet
 * (später zusätzlich für direkte Bild-Uploads über signierte URLs).
 * Alle Fachdaten laufen über unsere API.
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: secureSessionStorage,
    storageKey: 'parking.auth',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Token-Refresh nur, solange die App im Vordergrund ist (Empfehlung von Supabase für RN).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}
