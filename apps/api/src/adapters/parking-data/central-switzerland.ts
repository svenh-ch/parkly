import type { LiveEntry } from '../../services/facility-service';

/**
 * Echtzeit-Belegung Luzern und Zug.
 *
 * WICHTIG (rechtlich): Beide Parkleitsysteme veröffentlichen die Belegung auf ihren Websites,
 * aber NICHT als Open Data und ohne Nutzungsbedingungen für Dritte. Die Adapter sind deshalb
 * standardmässig AUS (LIVE_LUZERN_ENABLED / LIVE_ZUG_ENABLED) und dürfen erst eingeschaltet
 * werden, wenn der Betreiber schriftlich zugestimmt hat:
 *   - Parkleitsystem Luzern AG, info@pls-luzern.ch
 *   - Parkleitsystem Zug AG (c/o WWZ Energie AG), 041 748 45 45
 * Ohne Zustimmung zeigt die App dort "Keine Live-Daten".
 */

export const LUZERN_PLS_URL = 'https://info.pls-luzern.ch/TeqParkingWS/GetFreeParks';
export const ZUG_PLS_URL = 'https://www.pls-zug.ch/';

interface LuzernResponse {
  status?: string;
  data?: {
    parkings?: Record<
      string,
      { description?: string; vacancy?: number; datestamp?: string; capacity?: number; maintenance?: boolean; opened?: boolean }
    >;
  };
}

/** Werte älter als 2 Stunden gelten als "unbekannt" (Anzeige ausser Betrieb). */
const STALE_MS = 2 * 60 * 60_000;

export function parseLuzernPls(raw: unknown, now = new Date()): LiveEntry[] {
  const parkings = (raw as LuzernResponse).data?.parkings ?? {};
  return Object.entries(parkings).map(([key, p]) => {
    const observedAt = p.datestamp ? new Date(p.datestamp) : now;
    const stale = now.getTime() - observedAt.getTime() > STALE_MS || !p.capacity;
    return {
      key,
      freeSpaces: stale || typeof p.vacancy !== 'number' ? null : Math.max(0, p.vacancy),
      status: stale || p.maintenance ? 'UNKNOWN' : p.opened === false ? 'CLOSED' : 'OPEN',
      observedAt,
    };
  });
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&auml;/g, 'ä')
    .replace(/&ouml;/g, 'ö')
    .replace(/&uuml;/g, 'ü')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

/** Liest die Liste von pls-zug.ch: <li data-id><div class="free">170</div><h2>Name</h2> … FREI|BESETZT|GESCHLOSSEN */
export function parseZugPls(html: string, now = new Date()): LiveEntry[] {
  const items = html.match(/<li[^>]*data-id="[^"]*"[^>]*>[\s\S]*?<\/li>/g) ?? [];
  const out: LiveEntry[] = [];
  for (const li of items) {
    const name = li.match(/<h2>([\s\S]*?)<\/h2>/)?.[1];
    if (!name) continue;
    const free = li.match(/class="free">\s*(\d+)\s*</)?.[1];
    const text = li.replace(/<[^>]+>/g, ' ').toUpperCase();
    const closed = /GESCHLOSSEN/.test(text);
    out.push({
      key: decode(name),
      freeSpaces: closed || free === undefined ? (closed ? 0 : null) : Number(free),
      status: closed ? 'CLOSED' : free === undefined ? 'UNKNOWN' : 'OPEN',
      observedAt: now,
    });
  }
  return out;
}

export async function fetchLuzernPls(fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(LUZERN_PLS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`PLS Luzern HTTP ${res.status}`);
  return parseLuzernPls(await res.json());
}

export async function fetchZugPls(fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(ZUG_PLS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`PLS Zug HTTP ${res.status}`);
  return parseZugPls(await res.text());
}
