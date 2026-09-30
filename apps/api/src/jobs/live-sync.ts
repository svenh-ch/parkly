import type { FastifyBaseLogger } from 'fastify';
import type { FacilityService, LiveEntry } from '../services/facility-service';

export interface LiveSource {
  region: string;
  fetch: () => Promise<LiveEntry[]>;
}

/** Periodischer Abgleich weiterer Echtzeit-Quellen (nur eingeschaltete). */
export function startLiveSync(opts: {
  sources: LiveSource[];
  facilities: FacilityService;
  log: Pick<FastifyBaseLogger, 'info' | 'warn'>;
  intervalMs: number;
}): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    for (const s of opts.sources) {
      try {
        const res = await opts.facilities.applyLiveOccupancy(s.region, await s.fetch());
        opts.log.info({ region: s.region, updated: res.updated }, 'Echtzeit-Belegung synchronisiert');
        if (res.unknown.length) opts.log.warn({ region: s.region, unknown: res.unknown }, 'Einträge ohne Zuordnung');
      } catch (err) {
        opts.log.warn({ region: s.region, err: err instanceof Error ? err.message : String(err) }, 'Echtzeit-Quelle nicht erreichbar');
      }
    }
    running = false;
  };
  void tick();
  const id = setInterval(() => void tick(), opts.intervalMs);
  return () => clearInterval(id);
}
