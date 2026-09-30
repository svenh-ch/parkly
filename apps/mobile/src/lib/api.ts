import { createApiClient } from '@parking/api-client';
import { env } from './env';
import { supabase } from './supabase';

/** Einzige API-Instanz der App. Holt das jeweils aktuelle Access Token von Supabase. */
export const api = createApiClient({
  baseUrl: env.apiUrl,
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  onUnauthenticated: () => {
    // Session serverseitig ungültig (z. B. Konto gelöscht) -> lokal abmelden
    void supabase.auth.signOut({ scope: 'local' });
  },
});
