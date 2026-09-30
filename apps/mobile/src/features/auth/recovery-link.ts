import { supabase } from '@/lib/supabase';

/**
 * Verarbeitet den Link aus der "Passwort zurücksetzen"-E-Mail.
 * Supabase hängt die Tokens als URL-Fragment an: parking://reset-password#access_token=...&type=recovery
 * Liefert true, wenn eine Recovery-Session gesetzt wurde.
 */
export async function handleRecoveryLink(url: string | null): Promise<boolean> {
  if (!url || !url.includes('reset-password')) return false;
  const fragment = url.split('#')[1];
  if (!fragment) return false;

  const params = new URLSearchParams(fragment);
  const errorDescription = params.get('error_description');
  if (errorDescription) throw new Error(errorDescription);

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (params.get('type') !== 'recovery' || !accessToken || !refreshToken) return false;

  const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) throw error;
  return true;
}
