import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createDb, type DbHandle } from '../src/db/client';
import { SupabaseIdentityProvider } from '../src/adapters/identity';

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

const SUPABASE_URL = 'http://127.0.0.1:54321';
const JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

/** Signiert ein Token im Format von Supabase Auth (HS256-Variante). */
export async function makeToken(
  opts: { sub?: string; email?: string; role?: string; expiresIn?: string; secret?: string; issuer?: string } = {},
) {
  return new SignJWT({ email: opts.email ?? 'anna@example.ch', role: opts.role ?? 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(opts.sub ?? randomUUID())
    .setIssuer(opts.issuer ?? `${SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '1h')
    .sign(new TextEncoder().encode(opts.secret ?? JWT_SECRET));
}

export async function createTestApp(
  opts: {
    geocoder?: import('../src/adapters/geocoding').GeocodingProvider | null;
    routing?: import('../src/adapters/routing').RoutingProvider | null;
    walking?: import('../src/adapters/places').WalkingProvider | null;
    pois?: import('../src/adapters/places').PoiSearchProvider | null;
    storage?: import('../src/adapters/storage').StorageProvider | null;
    payments?: import('../src/adapters/payments').PaymentProvider;
  } = {},
) {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    SUPABASE_URL,
    SUPABASE_JWT_SECRET: JWT_SECRET,
    RATE_LIMIT_MAX: '1000',
  });
  const handle: DbHandle = createDb(config.DATABASE_URL, 5);
  const deleted: string[] = [];
  const identity = new SupabaseIdentityProvider({
    supabaseUrl: SUPABASE_URL,
    audience: 'authenticated',
    jwtSecret: JWT_SECRET,
  });
  // Konto-Löschung beim Provider im Test nur protokollieren
  identity.deleteIdentity = async (id: string) => {
    deleted.push(id);
  };
  const app = await buildApp({ config, db: handle.db, identity, geocoder: opts.geocoder ?? null, routing: opts.routing ?? null, walking: opts.walking ?? null, pois: opts.pois ?? null, storage: opts.storage ?? null, payments: opts.payments });
  await app.ready();
  return {
    app,
    db: handle.db,
    deletedIdentities: deleted,
    async close() {
      await app.close();
      await handle.close();
    },
  };
}

export async function truncateAll(db: DbHandle['db']) {
  await db.execute(sql`
    do $$ declare t text; begin
      for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'spatial_ref_sys' loop
        execute format('truncate table public.%I cascade', t);
      end loop;
    end $$;`);
}
