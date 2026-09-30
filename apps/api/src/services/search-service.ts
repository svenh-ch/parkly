import { sql } from 'drizzle-orm';
import type { PlaceSuggestion } from '@parking/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { GeocodingProvider } from '../adapters/geocoding';
import type { PoiSearchProvider } from '../adapters/places';
import type { Database } from '../db/client';

/**
 * Suche für "Wo möchtest du parken?":
 *  - Parkhäuser/Parkplätze, deren Name passt (aus unserer Datenbank)
 *  - Adressen, Orte, Quartiere, Gebäude (Geocoding-Provider, swisstopo)
 *  - Geschäfte, Restaurants, Hotels, Spitäler usw. (POI-Provider, openrouteservice/OSM)
 * Fällt ein Dienst aus, liefern die anderen trotzdem Treffer.
 */
export class SearchService {
  constructor(
    private readonly db: Database,
    private readonly geocoder: GeocodingProvider | null,
    private readonly log: Pick<FastifyBaseLogger, 'warn'>,
    private readonly pois: PoiSearchProvider | null = null,
  ) {}

  private async parkingMatches(q: string, limit: number): Promise<PlaceSuggestion[]> {
    const pattern = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const rows = await this.db.execute<{
      kind: 'PUBLIC_PARKING' | 'PRIVATE_MARKETPLACE_PARKING';
      id: string;
      name: string;
      detail: string | null;
      lat: number;
      lng: number;
    }>(sql`
      select * from (
        select 'PUBLIC_PARKING' as kind, f.id, f.name,
               nullif(concat_ws(', ', f.street, f.city), '') as detail,
               ST_Y(f.location) as lat, ST_X(f.location) as lng
        from parking_facilities f
        where f.is_active and (f.name ilike ${pattern} or f.street ilike ${pattern})
        union all
        select 'PRIVATE_MARKETPLACE_PARKING' as kind, s.id, s.title as name, null as detail,
               ST_Y(s.approx_location) as lat, ST_X(s.approx_location) as lng
        from parking_spots s
        where s.status = 'ACTIVE' and s.title ilike ${pattern}
      ) m
      order by length(m.name) asc
      limit ${limit}`);
    return rows.rows.map((r) => ({
      id: `${r.kind}:${r.id}`,
      type: 'PARKING' as const,
      label: r.name,
      detail: r.detail,
      lat: Number(r.lat),
      lng: Number(r.lng),
      parking: { kind: r.kind, id: r.id },
    }));
  }

  async search(q: string, near?: { lat: number; lng: number }): Promise<PlaceSuggestion[]> {
    const safe = <T,>(p: Promise<T[]>, what: string) =>
      p.catch((err: unknown) => {
        this.log.warn({ err: err instanceof Error ? err.message : String(err) }, `Ortssuche: ${what} nicht erreichbar`);
        return [] as T[];
      });
    const [parking, places, pois] = await Promise.all([
      this.parkingMatches(q, 3),
      this.geocoder?.suggest ? safe(this.geocoder.suggest(q, 8), 'swisstopo') : Promise.resolve([]),
      this.pois && q.length >= 3 ? safe(this.pois.suggest(q, 6, near), 'POI-Suche') : Promise.resolve([]),
    ]);

    const toPlace = (p: (typeof places)[number]): PlaceSuggestion => ({
      id: p.id, type: p.kind, label: p.label, detail: p.detail, lat: p.lat, lng: p.lng, parking: null,
    });
    const poiItems: PlaceSuggestion[] = pois.map((p) => ({
      id: p.id, type: 'POI', label: p.label, detail: p.detail, lat: p.lat, lng: p.lng, parking: null,
    }));
    const addresses = places.filter((p) => p.kind === 'ADDRESS').map(toPlace);
    const others = places.filter((p) => p.kind !== 'ADDRESS').map(toPlace);
    // Mit Hausnummer zuerst Adressen, sonst zuerst Orte und Geschäfte
    const ordered = /\d/.test(q)
      ? [...parking, ...addresses, ...poiItems, ...others]
      : [...parking, ...poiItems.slice(0, 4), ...others.slice(0, 3), ...addresses, ...poiItems.slice(4), ...others.slice(3)];

    const out: PlaceSuggestion[] = [];
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüé]+/g, ' ').trim();
    for (const item of ordered) {
      const dup = out.some(
        (o) => norm(o.label) === norm(item.label) && Math.abs(o.lat - item.lat) < 0.003 && Math.abs(o.lng - item.lng) < 0.004,
      );
      if (!dup) out.push(item);
      if (out.length >= 10) break;
    }
    return out;
  }
}
