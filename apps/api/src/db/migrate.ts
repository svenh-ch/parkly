import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL fehlt (siehe apps/api/.env.example)');
  process.exit(1);
}

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
const { db, close } = createDb(url, 1);

try {
  await migrate(db, { migrationsFolder });
  console.log('✔ Migrationen angewendet');
} catch (err) {
  console.error('✖ Migration fehlgeschlagen', err);
  process.exitCode = 1;
} finally {
  await close();
}
