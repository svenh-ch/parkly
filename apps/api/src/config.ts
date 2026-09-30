import { z } from 'zod';

/**
 * Zentrale, validierte Konfiguration. Alle Werte kommen aus Umgebungsvariablen;
 * es gibt keine hardcodierten Secrets. Beim Start wird hart abgebrochen, wenn etwas fehlt.
 */

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Kommagetrennte Liste erlaubter Web-Origins (Mobile-Apps senden keinen Origin). */
    CORS_ORIGINS: z.string().default(''),
    TRUST_PROXY: bool.default(false),

    DATABASE_URL: z.url(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    /** Basis-URL des Supabase-Projekts, z. B. http://127.0.0.1:54321 */
    SUPABASE_URL: z.url(),
    /**
     * Nur für Projekte mit Legacy-HS256-Secret. Neue Projekte verwenden asymmetrische
     * Signing Keys; diese werden automatisch über JWKS geladen.
     */
    SUPABASE_JWT_SECRET: z.string().min(32).optional(),
    SUPABASE_JWT_AUDIENCE: z.string().default('authenticated'),
    /** Nur serverseitig! Wird für Konto-Löschung und Storage-Signaturen benötigt. */
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),

    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    RATE_LIMIT_WINDOW: z.string().default('1 minute'),

    /** Adapter-Auswahl; "dev"-Adapter sind in production gesperrt. */
    PAYMENT_PROVIDER: z.enum(['stripe', 'dev']).default('dev'),
    /** Stripe: Keys aus dem Dashboard (Test: sk_test_/pk_test_). Nie ins Git, nie in die App (ausser pk_). */
    STRIPE_SECRET_KEY: z.string().trim().optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().trim().optional(),
    /** Signatur-Secret des Webhooks (whsec_…). Lokal optional: die App fragt den Status selbst ab. */
    STRIPE_WEBHOOK_SECRET: z.string().trim().optional(),
    /** So viele Stunden nach Buchungsende wird an den Vermieter ausbezahlt (Zeit für Reklamationen). */
    PAYOUT_DELAY_HOURS: z.coerce.number().int().min(0).max(24 * 14).default(24),
    /** Hintergrund-Jobs für Buchungen (Reservierung abgelaufen, abschliessen, Auszahlungen). */
    BOOKING_JOBS_ENABLED: bool.default(true),
    STORAGE_PROVIDER: z.enum(['supabase', 'dev']).default('supabase'),
    STORAGE_BUCKET: z.string().default('spot-images'),
    /** Nur STORAGE_PROVIDER=dev: Ordner und öffentliche API-Adresse für Foto-URLs. */
    DEV_STORAGE_DIR: z.string().default('.dev-storage'),
    PUBLIC_API_URL: z.url().optional(),

    ENABLE_API_DOCS: bool.default(false),

    /** Echtzeit-Belegung Parkleitsystem Zürich abrufen (im Test aus). */
    PLS_SYNC_ENABLED: bool.default(true),
    PLS_SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(60).default(180),
    /** Geocoding für neue Parkhäuser (swisstopo, frei nutzbar) oder aus. */
    GEOCODING_PROVIDER: z.enum(['swisstopo', 'none']).default('swisstopo'),
    /** Nur für Tests: andere Adresse des swisstopo SearchServers. */
    SWISSTOPO_SEARCH_URL: z.url().optional(),

    /** Echtzeit Luzern/Zug: nur nach schriftlicher Zustimmung der Betreiber einschalten (siehe README). */
    LIVE_LUZERN_ENABLED: bool.default(false),
    LIVE_ZUG_ENABLED: bool.default(false),

    /** In-App-Route. Ohne Key ist die Route in der App aus (Fallback Apple/Google Maps). */
    ROUTING_PROVIDER: z.enum(['openrouteservice', 'mapbox', 'none']).default('openrouteservice'),
    ORS_API_KEY: z.string().trim().optional(),
    /** Nur für Tests/eigene Instanz, sonst leer lassen. */
    ORS_BASE_URL: z.url().optional(),
    MAPBOX_ACCESS_TOKEN: z.string().trim().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === 'stripe') {
      if (!env.STRIPE_SECRET_KEY?.startsWith('sk_') && !env.STRIPE_SECRET_KEY?.startsWith('rk_')) {
        ctx.addIssue({ code: 'custom', path: ['STRIPE_SECRET_KEY'], message: 'fehlt oder ungültig (beginnt mit sk_test_ oder sk_live_)' });
      }
      if (!env.STRIPE_PUBLISHABLE_KEY?.startsWith('pk_')) {
        ctx.addIssue({ code: 'custom', path: ['STRIPE_PUBLISHABLE_KEY'], message: 'fehlt oder ungültig (beginnt mit pk_test_ oder pk_live_)' });
      }
    }
    if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'stripe' && !env.STRIPE_WEBHOOK_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['STRIPE_WEBHOOK_SECRET'], message: 'In production Pflicht' });
    }
    if (env.NODE_ENV === 'production') {
      if (env.PAYMENT_PROVIDER === 'dev') {
        ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'dev-Adapter in production nicht erlaubt' });
      }
      if (env.STORAGE_PROVIDER === 'dev') {
        ctx.addIssue({ code: 'custom', path: ['STORAGE_PROVIDER'], message: 'dev-Adapter in production nicht erlaubt' });
      }
      if (!env.SUPABASE_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['SUPABASE_URL'], message: 'In production ist https Pflicht' });
      }
    }
  });

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Konfiguration:\n${issues}\nSiehe apps/api/.env.example`);
  }
  return parsed.data;
}
