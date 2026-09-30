import { defineConfig } from 'vitest/config';

// Lokale .env laden (für TEST_DATABASE_URL), falls vorhanden
try {
  process.loadEnvFile('.env');
} catch {
  /* keine .env vorhanden: DB-Tests werden übersprungen */
}

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
