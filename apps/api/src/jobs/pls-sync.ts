import type { FastifyBaseLogger } from 'fastify';
import type { GeocodingProvider } from '../adapters/geocoding';
import { fetchPlsFeed, type PlsEntry } from '../adapters/parking-data/zuerich-pls';
import type { FacilityService } from '../services/facility-service';

/** Nach einem erfolglosen Geocoding-Versuch erst nach dieser Zeit erneut versuchen. */
const GEOCODE_RETRY_MS = 24 * 60 * 60_000;

export interface PlsSyncOptions {
  facilities: FacilityService;
  geocoder: GeocodingProvider | null;
  log: Pick<FastifyBaseLogger, 'info' | 'warn'>;
  fetchImpl?: typeof fetch;
}

export interface PlsSyncState {
  geocodeAttempts: Map<string, number>;
  lastUnknown: string;
}

export const newPlsSyncState = (): PlsSyncState => ({ geocodeAttempts: new Map(), lastUnknown: '' });

/**
 * Ein Sync-Durchlauf: Belegung übernehmen; neue Parkhäuser im Feed (ohne bekannten Standort)
 * über ihre Adresse verorten (Geocoding) und automatisch anlegen.
 */
export async function runPlsSyncOnce(opts: PlsSyncOptions, state: PlsSyncState) {
  const entries = await fetchPlsFeed(opts.fetchImpl);
  const first = await opts.facilities.applyPlsOccupancy(entries);

  const created: PlsEntry[] = [];
  if (opts.geocoder && first.unknownEntries.length) {
    const bounds = await opts.facilities.regionBounds('zuerich');
    for (const e of first.unknownEntries) {
      const last = state.geocodeAttempts.get(e.name);
      if (last !== undefined && Date.now() - last < GEOCODE_RETRY_MS) continue;
      state.geocodeAttempts.set(e.name, Date.now());

      const queries = [e.street ? `${e.street} Zürich` : null, `${e.name} Zürich`].filter((q): q is string => !!q);
      try {
        for (const q of queries) {
          const hit = await opts.geocoder.geocode(q, bounds);
          if (hit) {
            await opts.facilities.createFromPls(e, hit);
            opts.log.info({ name: e.name, label: hit.label }, 'Neues Parkhaus verortet und angelegt');
            created.push(e);
            break;
          }
        }
      } catch (err) {
        opts.log.warn({ err, name: e.name }, 'Geocoding fehlgeschlagen');
      }
    }
    if (created.length) await opts.facilities.applyPlsOccupancy(created);
  }

  const stillUnknown = first.unknown.filter((n) => !created.some((c) => c.name === n));
  const key = stillUnknown.join('|');
  if (stillUnknown.length && key !== state.lastUnknown) {
    opts.log.warn({ unknown: stillUnknown }, 'Parkhäuser im Feed ohne Standort (nicht auf der Karte)');
  }
  state.lastUnknown = key;

  const result = { updated: first.updated + created.length, total: entries.length, created: created.map((c) => c.name), stillUnknown };
  opts.log.info({ updated: result.updated, total: result.total }, 'Parkleitsystem synchronisiert');
  return result;
}

/** Startet den periodischen Sync im API-Prozess (später auslagerbar in einen Worker). */
export function startPlsSync(opts: PlsSyncOptions & { intervalMs: number }): () => void {
  const state = newPlsSyncState();
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runPlsSyncOnce(opts, state);
    } catch (err) {
      opts.log.warn({ err }, 'Parkleitsystem nicht erreichbar, nächster Versuch im nächsten Intervall');
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), opts.intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
