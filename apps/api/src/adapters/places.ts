/**
 * Orte/Geschäfte (POI) und Fusswege.
 *
 * Adapter openrouteservice (gleicher Key wie die Route, ORS_API_KEY):
 *  - Geocoding/Autocomplete (Pelias, OpenStreetMap-Daten): 3000 Anfragen/Tag, 100/Minute gratis
 *  - Matrix foot-walking (Gehdistanzen): 500 Anfragen/Tag, 40/Minute gratis
 *  Kommerziell erlaubt; Quellenangabe "© openrouteservice.org by HeiGIT | © OpenStreetMap-Mitwirkende".
 * Beide Ergebnisse werden kurz im Speicher gecacht (kein Personenbezug: Suchtext bzw. Ziel),
 * damit das Gratis-Kontingent reicht.
 */

export interface PoiResult {
  id: string;
  label: string;
  detail: string | null;
  lat: number;
  lng: number;
}

export interface PoiSearchProvider {
  suggest(query: string, limit: number, near?: { lat: number; lng: number }): Promise<PoiResult[]>;
}

export interface WalkingProvider {
  /** Fusswege von `from` zu allen `to` (gleiche Reihenfolge); null = nicht erreichbar. */
  walk(from: { lat: number; lng: number }, to: { lat: number; lng: number }[]): Promise<({ meters: number; seconds: number } | null)[]>;
}

/** Kleiner LRU-Cache mit Ablaufzeit. */
export class TtlCache<V> {
  private map = new Map<string, { v: V; at: number }>();
  constructor(
    private readonly ttlMs: number,
    private readonly max = 2000,
  ) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.v;
  }
  set(key: string, v: V) {
    this.map.set(key, { v, at: Date.now() });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}

interface PeliasFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    gid?: string;
    name?: string;
    layer?: string;
    street?: string;
    housenumber?: string;
    locality?: string;
    localadmin?: string;
    region_a?: string;
  };
}

export function parsePelias(raw: unknown): PoiResult[] {
  const features = (raw as { features?: PeliasFeature[] }).features ?? [];
  const out: PoiResult[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    if (!p.name || !c) continue;
    const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : null;
    const town = p.locality ?? p.localadmin ?? null;
    out.push({
      id: `ors:${p.gid ?? `${c[1]},${c[0]}`}`,
      label: p.name,
      detail: [street, town].filter(Boolean).join(', ') || null,
      lat: c[1],
      lng: c[0],
    });
  }
  return out;
}

export class OrsPoiSearch implements PoiSearchProvider {
  private cache = new TtlCache<PoiResult[]>(24 * 60 * 60_000);

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = 'https://api.openrouteservice.org',
  ) {}

  async suggest(query: string, limit: number, near?: { lat: number; lng: number }): Promise<PoiResult[]> {
    // Position nur grob (ca. 1 km) weitergeben: reicht für die Reihenfolge, schützt die Privatsphäre
    const focus = near ? { lat: near.lat.toFixed(2), lng: near.lng.toFixed(2) } : null;
    const key = `${query.toLowerCase()}|${limit}|${focus?.lat ?? ''},${focus?.lng ?? ''}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/geocode/autocomplete`);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('text', query);
    url.searchParams.set('boundary.country', 'CH');
    url.searchParams.set('layers', 'venue');
    url.searchParams.set('size', String(Math.min(limit, 10)));
    url.searchParams.set('lang', 'de');
    if (focus) {
      url.searchParams.set('focus.point.lat', focus.lat);
      url.searchParams.set('focus.point.lon', focus.lng);
    }
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`openrouteservice Geocoding HTTP ${res.status}`);
    const items = parsePelias(await res.json());
    this.cache.set(key, items);
    return items;
  }
}

export class OrsWalking implements WalkingProvider {
  private cache = new TtlCache<({ meters: number; seconds: number } | null)[]>(10 * 60_000, 500);

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = 'https://api.openrouteservice.org',
  ) {}

  async walk(from: { lat: number; lng: number }, to: { lat: number; lng: number }[]) {
    if (!to.length) return [];
    const key = [from, ...to].map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
    const cached = this.cache.get(key);
    if (cached) return cached;
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/v2/matrix/foot-walking`, {
      method: 'POST',
      headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: [from, ...to].map((p) => [p.lng, p.lat]),
        sources: [0],
        destinations: to.map((_, i) => i + 1),
        metrics: ['distance', 'duration'],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`openrouteservice Matrix HTTP ${res.status}`);
    const body = (await res.json()) as { distances?: (number | null)[][]; durations?: (number | null)[][] };
    const d = body.distances?.[0] ?? [];
    const t = body.durations?.[0] ?? [];
    const out = to.map((_, i) =>
      typeof d[i] === 'number' && typeof t[i] === 'number' ? { meters: Math.round(d[i]!), seconds: Math.round(t[i]!) } : null,
    );
    this.cache.set(key, out);
    return out;
  }
}
