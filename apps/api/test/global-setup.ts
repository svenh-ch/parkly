import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../src/db/client';

/**
 * Integrationstests laufen gegen eine echte PostgreSQL/PostGIS-Datenbank.
 * TEST_DATABASE_URL zeigt auf eine Wegwerf-Datenbank, die hier neu aufgebaut wird.
 * Ohne TEST_DATABASE_URL werden nur Unit-Tests ausgeführt.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn('\n⚠ TEST_DATABASE_URL nicht gesetzt: DB-Integrationstests werden übersprungen.\n');
    return;
  }

  const dbName = new URL(url).pathname.slice(1);
  if (!/_test$/.test(dbName)) {
    throw new Error(`Sicherheitsabbruch: Test-Datenbank muss auf "_test" enden (ist "${dbName}")`);
  }

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  const { db, close } = createDb(url, 1);
  const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');
  await migrate(db, { migrationsFolder });
  await close();
}
