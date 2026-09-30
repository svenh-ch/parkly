/**
 * Geocoding-Port: Adresse -> Koordinate.
 *
 * Standard-Adapter: swisstopo SearchServer (api3.geo.admin.ch)
 *   Lizenz:  Freie Geodaten des Bundes (OGD), kommerzielle Nutzung erlaubt, Quellenangabe "© swisstopo"
 *   Kosten:  keine
 *   Limits:  Fair Use; wir rufen nur für neue, unbekannte Objekte auf und cachen das Ergebnis in der DB
 *   Abdeckung: Schweiz. Für weitere Länder später einen zweiten Adapter (z. B. Mapbox, Google) ergänzen.
 */

export interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
}

export interface Bounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface PlaceResult extends GeocodeResult {
  id: string;
  kind: 'ADDRESS' | 'PLACE';
  detail: string | null;
}

export interface GeocodingProvider {
  geocode(query: string, within?: Bounds): Promise<GeocodeResult | null>;
  /** Vorschläge beim Tippen (Adressen, Orte, Quartiere). */
  suggest?(query: string, limit: number): Promise<PlaceResult[]>;
}

const inside = (r: GeocodeResult, b?: Bounds) =>
  !b || (r.lat >= b.minLat && r.lat <= b.maxLat && r.lng >= b.minLng && r.lng <= b.maxLng);

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '').trim();

export class SwisstopoGeocoder implements GeocodingProvider {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = 'https://api3.geo.admin.ch/rest/services/api/SearchServer',
  ) {}

  async geocode(query: string, within?: Bounds): Promise<GeocodeResult | null> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('searchText', query);
    url.searchParams.set('type', 'locations');
    url.searchParams.set('limit', '5');
    url.searchParams.set('sr', '4326');

    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`swisstopo antwortet mit HTTP ${res.status}`);
    const body = (await res.json()) as {
      results?: { attrs?: { lat?: unknown; lon?: unknown; label?: unknown; origin?: unknown } }[];
    };

    const candidates: (GeocodeResult & { origin: string })[] = [];
    for (const r of body.results ?? []) {
      const lat = Number(r.attrs?.lat);
      const lng = Number(r.attrs?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      candidates.push({
        lat,
        lng,
        label: stripHtml(String(r.attrs?.label ?? query)),
        origin: String(r.attrs?.origin ?? ''),
      });
    }
    // Adressen bevorzugen, dann Orte/POIs; nur Treffer im erwarteten Gebiet
    const ordered = [...candidates.filter((c) => c.origin === 'address'), ...candidates.filter((c) => c.origin !== 'address')];
    const hit = ordered.find((c) => inside(c, within));
    return hit ? { lat: hit.lat, lng: hit.lng, label: hit.label } : null;
  }

  async suggest(query: string, limit: number): Promise<PlaceResult[]> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('searchText', query);
    url.searchParams.set('type', 'locations');
    url.searchParams.set('origins', 'address,zipcode,gg25,district,gazetteer');
    url.searchParams.set('limit', String(Math.min(limit, 20)));
    url.searchParams.set('sr', '4326');

    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`swisstopo antwortet mit HTTP ${res.status}`);
    const body = (await res.json()) as {
      results?: { id?: unknown; attrs?: { lat?: unknown; lon?: unknown; label?: unknown; origin?: unknown; detail?: unknown } }[];
    };
    const out: PlaceResult[] = [];
    for (const r of body.results ?? []) {
      const lat = Number(r.attrs?.lat);
      const lng = Number(r.attrs?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const origin = String(r.attrs?.origin ?? '');
      const raw = stripHtml(String(r.attrs?.label ?? ''));
      if (!raw) continue;
      const { label, detail } = origin === 'gazetteer' ? cleanGazetteer(raw) : { label: raw, detail: originLabel[origin] ?? null };
      // Doppelte Namen (z. B. "Gebäude" und "Einzelhaus" desselben Objekts) nur einmal
      if (out.some((o) => o.label === label && Math.abs(o.lat - lat) < 0.003 && Math.abs(o.lng - lng) < 0.003)) continue;
      out.push({
        id: `swisstopo:${String(r.id ?? `${lat},${lng}`)}`,
        kind: origin === 'address' ? 'ADDRESS' : 'PLACE',
        label,
        detail: origin === 'address' ? null : detail,
        lat,
        lng,
      });
    }
    return out;
  }
}

/** Objektarten im swissNAMES3D-Namensverzeichnis, die vor dem eigentlichen Namen stehen. */
const GAZETTEER_PREFIX =
  /^(Gebaeude|Einzelhaus|Quartierteil|Quartier|Spitalareal|Areal|Ortsteil|Ort|Siedlung|Flurname|Strasse|Platz|Sportanlage|Stadion|Schulareal|Friedhof|Kirche|Bahnhof|Haltestelle|Ueberbauung)\s+/;

/** "Gebaeude Einzelhaus Stadion Letzigrund (ZH) - Zürich" -> { "Stadion Letzigrund", "Zürich" } */
export function cleanGazetteer(raw: string): { label: string; detail: string | null } {
  const m = raw.match(/^(.*?)\s*\(([A-Z]{2})\)\s*(?:-\s*(.+))?$/);
  let name = (m?.[1] ?? raw).trim();
  const town = m?.[3]?.trim() ?? null;
  for (let i = 0; i < 3 && GAZETTEER_PREFIX.test(name) && name.split(/\s+/).length > 1; i++) {
    const next = name.replace(GAZETTEER_PREFIX, '');
    // "Stadion Letzigrund" behalten: nur Objektarten entfernen, nicht Teile des Namens
    if (/^(Stadion|Bahnhof|Friedhof|Kirche|Platz|Strasse)\s/.test(name) && !/^(Gebaeude|Einzelhaus)/.test(name)) break;
    name = next;
  }
  return { label: name, detail: town ? `${town}${m?.[2] ? ` (${m[2]})` : ''}` : 'Ort' };
}

const originLabel: Record<string, string> = {
  zipcode: 'Postleitzahl',
  gg25: 'Gemeinde',
  district: 'Bezirk',
  gazetteer: 'Ort',
};
