import Constants from 'expo-constants';
import { z } from 'zod';

/**
 * Öffentliche Laufzeitkonfiguration. EXPO_PUBLIC_*-Variablen werden beim Build eingebettet
 * und müssen darum statisch (process.env.EXPO_PUBLIC_X) referenziert werden.
 *
 * Im Entwicklungsmodus werden fehlende URLs automatisch aus der IP des Entwicklungsrechners
 * abgeleitet (dieselbe IP, von der Metro das Bundle liefert). So funktioniert die App
 * auf Simulator und echtem Gerät ohne manuelle IP-Pflege.
 */

function devHost(): string | null {
  if (!__DEV__) return null;
  const hostUri = Constants.expoConfig?.hostUri; // z. B. "192.168.1.20:8081"
  const host = hostUri?.split(':')[0];
  return host || 'localhost';
}

function withDevFallback(value: string | undefined, port: number): string | undefined {
  if (value) return value;
  const host = devHost();
  return host ? `http://${host}:${port}` : undefined;
}

const schema = z.object({
  apiUrl: z.url({ message: 'EXPO_PUBLIC_API_URL fehlt oder ist ungültig' }),
  supabaseUrl: z.url({ message: 'EXPO_PUBLIC_SUPABASE_URL fehlt oder ist ungültig' }),
  supabaseAnonKey: z.string().min(20, 'EXPO_PUBLIC_SUPABASE_ANON_KEY fehlt'),
});

const parsed = schema.safeParse({
  apiUrl: withDevFallback(process.env.EXPO_PUBLIC_API_URL, 4000),
  supabaseUrl: withDevFallback(process.env.EXPO_PUBLIC_SUPABASE_URL, 54321),
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

export const envError: string | null = parsed.success
  ? null
  : parsed.error.issues.map((i) => i.message).join('\n');

export const env = parsed.success
  ? parsed.data
  : { apiUrl: 'http://invalid.local', supabaseUrl: 'http://invalid.local', supabaseAnonKey: 'invalid-key-placeholder' };
