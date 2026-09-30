import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { SupabaseIdentityProvider } from './adapters/identity';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL, config.DATABASE_POOL_MAX);

const identity = new SupabaseIdentityProvider({
  supabaseUrl: config.SUPABASE_URL,
  audience: config.SUPABASE_JWT_AUDIENCE,
  jwtSecret: config.SUPABASE_JWT_SECRET,
  serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
});

const app = await buildApp({ config, db, identity });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Fahre herunter');
  try {
    await app.close();
    await close();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'Fehler beim Herunterfahren');
    process.exit(1);
  }
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.error({ err }, 'Start fehlgeschlagen');
  await close();
  process.exit(1);
}
