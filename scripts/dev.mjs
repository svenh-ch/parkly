#!/usr/bin/env node
/**
 * Startet die komplette lokale Entwicklungsumgebung mit einem Befehl:
 *   1. Supabase (Datenbank, Login, Storage) in Docker
 *   2. Migrationen und Stammdaten
 *   3. API im Hintergrund (Ausgabe mit [api] markiert, nur Warnungen/Fehler)
 *   4. Expo im Vordergrund (QR-Code und Tastenkürzel funktionieren)
 * Ctrl+C beendet API und Expo sauber. Supabase läuft weiter (stoppen: pnpm db:stop).
 */
import { spawn, spawnSync } from 'node:child_process';

const run = (cmd, args, label) => {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`\n✖ ${label} fehlgeschlagen.`);
    if (label.includes('Supabase')) console.error('  Läuft Docker Desktop? (Wal-Symbol in der Menüleiste)');
    process.exit(r.status ?? 1);
  }
};

run('pnpm', ['exec', 'supabase', 'start'], 'Supabase starten');
run('pnpm', ['db:migrate'], 'Datenbank-Migrationen');
run('pnpm', ['db:seed'], 'Stammdaten und Parkhäuser');

console.log('\n▶ API starten (Hintergrund)');
const api = spawn('pnpm', ['--filter', '@parking/api', 'dev'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true, // eigene Prozessgruppe, damit wir sie gezielt beenden können
  env: { ...process.env, LOG_LEVEL: process.env.API_LOG_LEVEL ?? 'warn', FORCE_COLOR: '1' },
});
const prefix = (stream, out) => {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) out.write(`\x1b[34m[api]\x1b[0m ${line}\n`);
  });
};
prefix(api.stdout, process.stdout);
prefix(api.stderr, process.stderr);

let stopping = false;
const stopApi = () => {
  if (stopping) return;
  stopping = true;
  try {
    process.kill(-api.pid, 'SIGTERM');
  } catch {
    /* schon beendet */
  }
};

// Warten, bis die API antwortet, dann Expo starten
const waitForApi = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://127.0.0.1:4000/health');
      if (res.ok) return true;
    } catch {
      /* noch nicht bereit */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

if (await waitForApi()) console.log('✔ API läuft auf Port 4000\n');
else console.warn('⚠ API antwortet noch nicht. Logs mit [api] prüfen.\n');

const expo = spawn('pnpm', ['--filter', '@parking/mobile', 'start'], { stdio: 'inherit' });

process.on('SIGINT', () => {
  stopApi();
});
process.on('SIGTERM', () => {
  stopApi();
  expo.kill('SIGTERM');
});
expo.on('exit', (code) => {
  stopApi();
  console.log('\n✔ App und API beendet. Datenbank läuft weiter (stoppen mit: pnpm db:stop)');
  process.exit(code ?? 0);
});
api.on('exit', (code) => {
  if (!stopping) console.error(`\n✖ API wurde beendet (Code ${code}). Details oben bei [api].`);
});
