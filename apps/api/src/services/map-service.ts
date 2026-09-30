import { asc, eq, sql, type SQL } from 'drizzle-orm';
import {
  headlinePrice,
  normalizeBbox,
  type CurrencyCode,
  type FacilityDetail,
  type FacilityStatus,
  type MapCluster,
  type MapItem,
  type MapQuery,
  type MapResponse,
  type NearbyItem,
  type NearbyQuery,
  type Occupancy,
  type ParkingKind,
} from '@parking/shared';
import type { Database } from '../db/client';
import { dataSources, facilityTariffs } from '../db/schema';
import { AppError } from '../lib/errors';
import type { WalkingProvider } from '../adapters/places';
import type { FastifyBaseLogger } from 'fastify';

/** Unterhalb dieser Zoomstufe werden Pins serverseitig zu Clustern zusammengefasst. */
const CLUSTER_BELOW_ZOOM = 11;
/** Maximale Anzahl einzelner Pins pro Antwort; darüber wird ebenfalls geclustert. */
const MAX_ITEMS = 400;
/** Belegungsdaten älter als das gelten als nicht mehr aktuell. */
const OCCUPANCY_MAX_AGE_MS = 30 * 60_000;

export interface Row extends Record<string, unknown> {
  kind: ParkingKind;
  id: string;
  name: string;
  lat: number;
  lng: number;
  capacity: number | null;
  free_spaces: number | null;
  occ_status: FacilityStatus | null;
  observed_at: Date | string | null;
  price_hourly: number | null;
  price_daily: number | null;
  price_weekly: number | null;
  price_monthly: number | null;
  currency: string | null;
  rating_avg: string | number | null;
  rating_count: number;
  is_favorite: boolean;
  distance: number | null;
}

interface PointsOptions {
  kinds: ParkingKind[];
  filter: (geom: SQL) => SQL;
  userId: string | null;
  distanceFrom?: SQL;
  /** true = nur Favoriten, false = ohne Favoriten, undefined = alle */
  favorites?: boolean;
}

export class MapService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
    private readonly walking: WalkingProvider | null = null,
    private readonly log?: Pick<FastifyBaseLogger, 'warn'>,
  ) {}

  private occupancy(row: Pick<Row, 'free_spaces' | 'occ_status' | 'observed_at'>): Occupancy | null {
    if (!row.occ_status || !row.observed_at) return null;
    const observedAt = new Date(row.observed_at);
    return {
      freeSpaces: row.free_spaces,
      status: row.occ_status,
      observedAt: observedAt.toISOString(),
      isLive: this.now().getTime() - observedAt.getTime() < OCCUPANCY_MAX_AGE_MS,
    };
  }

  toItem(row: Row): MapItem {
    const price =
      row.kind === 'PRIVATE_MARKETPLACE_PARKING'
        ? headlinePrice({
            hourly: row.price_hourly,
            daily: row.price_daily,
            weekly: row.price_weekly,
            monthly: row.price_monthly,
          })
        : null;
    return {
      kind: row.kind,
      id: row.id,
      name: row.name,
      lat: Number(row.lat),
      lng: Number(row.lng),
      capacity: row.capacity,
      occupancy: row.kind === 'PUBLIC_PARKING' ? this.occupancy(row) : null,
      price: price ? { ...price, currency: (row.currency?.trim() ?? 'CHF') as CurrencyCode } : null,
      rating: { avg: row.rating_avg === null ? null : Number(row.rating_avg), count: row.rating_count ?? 0 },
      isFavorite: !!row.is_favorite,
    };
  }

  /**
   * Gemeinsame Punktquelle für beide Parkplatz-Arten. Private Plätze werden ausschliesslich
   * mit ihrer ungefähren Position (approx_location) ausgeliefert.
   */
  pointsSql(o: PointsOptions): SQL {
    const distance = (geom: SQL) =>
      o.distanceFrom ? sql`ST_Distance(${geom}::geography, ${o.distanceFrom}::geography)` : sql`null::float8`;
    const fav = (column: SQL, id: SQL) =>
      o.userId
        ? sql`exists (select 1 from favorites fav where fav.user_id = ${o.userId} and ${column} = ${id})`
        : sql`false`;
    const favFilter = (expr: SQL) =>
      o.favorites === true ? sql` and ${expr}` : o.favorites === false ? sql` and not ${expr}` : sql``;

    const parts: SQL[] = [];
    if (o.kinds.includes('PUBLIC_PARKING')) {
      const g = sql`f.location`;
      const isFav = fav(sql`fav.facility_id`, sql`f.id`);
      parts.push(sql`
        select 'PUBLIC_PARKING'::text as kind, f.id, f.name, ST_Y(f.location) as lat, ST_X(f.location) as lng,
               f.capacity, o.free_spaces, o.status::text as occ_status, o.observed_at,
               null::int as price_hourly, null::int as price_daily, null::int as price_weekly, null::int as price_monthly,
               null::text as currency, f.rating_avg, f.rating_count, ${isFav} as is_favorite,
               ${distance(g)} as distance, f.location as geom
        from parking_facilities f
        left join facility_occupancy o on o.facility_id = f.id
        where f.is_active and ${o.filter(g)}${favFilter(isFav)}`);
    }
    if (o.kinds.includes('PRIVATE_MARKETPLACE_PARKING')) {
      const g = sql`s.approx_location`;
      const isFav = fav(sql`fav.spot_id`, sql`s.id`);
      parts.push(sql`
        select 'PRIVATE_MARKETPLACE_PARKING'::text as kind, s.id, s.title as name,
               ST_Y(s.approx_location) as lat, ST_X(s.approx_location) as lng,
               null::int as capacity, null::int as free_spaces, null::text as occ_status, null::timestamptz as observed_at,
               s.price_hourly, s.price_daily, s.price_weekly, s.price_monthly, s.currency::text as currency,
               s.rating_avg, s.rating_count, ${isFav} as is_favorite,
               ${distance(g)} as distance, s.approx_location as geom
        from parking_spots s
        where s.status = 'ACTIVE' and ${o.filter(g)}${favFilter(isFav)}`);
    }
    return sql.join(parts, sql` union all `);
  }

  async map(query: MapQuery, userId: string | null): Promise<MapResponse> {
    const b = normalizeBbox(query);
    const envelope = sql`ST_MakeEnvelope(${b.minLng}, ${b.minLat}, ${b.maxLng}, ${b.maxLat}, 4326)`;
    const inBox = (g: SQL) => sql`${g} && ${envelope}`;
    const favoritesOnly = query.favoritesOnly && !!userId;
    if (query.favoritesOnly && !userId) return { mode: 'items', items: [], clusters: [], truncated: false };

    if (query.zoom >= CLUSTER_BELOW_ZOOM || favoritesOnly) {
      const points = this.pointsSql({ kinds: query.kinds, filter: inBox, userId, favorites: favoritesOnly || undefined });
      const result = await this.db.execute<Row>(
        sql`select * from (${points}) p order by p.is_favorite desc limit ${MAX_ITEMS + 1}`,
      );
      if (result.rows.length <= MAX_ITEMS || favoritesOnly) {
        return {
          mode: 'items',
          items: result.rows.slice(0, MAX_ITEMS).map((r) => this.toItem(r)),
          clusters: [],
          truncated: result.rows.length > MAX_ITEMS,
        };
      }
    }

    // Cluster-Modus: Favoriten bleiben immer einzelne Pins, der Rest wird zusammengefasst.
    // Rastergrösse ~1/6 der sichtbaren Breite -> höchstens ~40 Cluster auf dem Bildschirm
    const cell = Math.max((b.maxLng - b.minLng) / 6, 0.0005);
    const others = this.pointsSql({ kinds: query.kinds, filter: inBox, userId, favorites: userId ? false : undefined });
    const [clusterRows, favRows] = await Promise.all([
      this.db.execute<{ lat: number; lng: number; count: number }>(sql`
        select count(*)::int as count,
               ST_Y(ST_Centroid(ST_Collect(p.geom))) as lat,
               ST_X(ST_Centroid(ST_Collect(p.geom))) as lng
        from (${others}) p
        group by ST_SnapToGrid(p.geom, ${cell})`),
      userId
        ? this.db.execute<Row>(
            sql`select * from (${this.pointsSql({ kinds: query.kinds, filter: inBox, userId, favorites: true })}) p limit ${MAX_ITEMS}`,
          )
        : Promise.resolve({ rows: [] as Row[] }),
    ]);
    const clusters: MapCluster[] = clusterRows.rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lng), count: r.count }));
    return { mode: 'clusters', items: favRows.rows.map((r) => this.toItem(r)), clusters, truncated: false };
  }

  async nearby(query: NearbyQuery, userId: string | null): Promise<NearbyItem[]> {
    const origin = sql`ST_SetSRID(ST_MakePoint(${query.lng}, ${query.lat}), 4326)`;
    const points = this.pointsSql({
      kinds: ['PUBLIC_PARKING', 'PRIVATE_MARKETPLACE_PARKING'],
      filter: (g) => sql`ST_DWithin(${g}::geography, ${origin}::geography, ${query.radius})`,
      distanceFrom: origin,
      userId,
    });
    // Für die Gehdistanz mehr Kandidaten holen: der kürzeste Fussweg ist nicht immer der nächste Punkt
    const fetchLimit = query.walk && this.walking ? Math.min(Math.max(query.limit + 4, 12), 25) : query.limit;
    const result = await this.db.execute<Row>(sql`select * from (${points}) p order by p.distance asc limit ${fetchLimit}`);
    const items: NearbyItem[] = result.rows.map((r) => ({ ...this.toItem(r), distanceMeters: Math.round(Number(r.distance)) }));
    if (!query.walk || !this.walking || !items.length) return items.slice(0, query.limit);

    // Nur Kandidaten in Gehweite (3 km Luftlinie) an den Fussweg-Dienst schicken
    const walkable = items.filter((i) => i.distanceMeters <= 3000);
    if (!walkable.length) return items.slice(0, query.limit);
    try {
      const walks = await this.walking.walk({ lat: query.lat, lng: query.lng }, walkable.map((i) => ({ lat: i.lat, lng: i.lng })));
      walkable.forEach((item, idx) => {
        item.walkMeters = walks[idx]?.meters ?? null;
        item.walkSeconds = walks[idx]?.seconds ?? null;
      });
      const sortKey = (i: NearbyItem) => i.walkMeters ?? i.distanceMeters * 1.3;
      return walkable.sort((a, b) => sortKey(a) - sortKey(b)).slice(0, query.limit);
    } catch (err) {
      this.log?.warn({ err: err instanceof Error ? err.message : String(err) }, 'Gehdistanz nicht verfügbar');
      return items.slice(0, query.limit);
    }
  }

  async facility(id: string, userId: string | null): Promise<FacilityDetail> {
    const result = await this.db.execute<
      Row & {
        operator: string | null;
        facility_type: string;
        street: string | null;
        postal_code: string | null;
        city: string | null;
        opening_hours: string | null;
        has_ev_charging: boolean | null;
        max_height_cm: number | null;
        website: string | null;
        source_id: string;
      }
    >(sql`
      select f.id, f.name, f.operator, f.facility_type, f.street, f.postal_code, f.city,
             ST_Y(f.location) as lat, ST_X(f.location) as lng, f.capacity, f.opening_hours,
             f.has_ev_charging, f.max_height_cm, f.website, f.source_id, f.rating_avg, f.rating_count,
             ${userId ? sql`exists (select 1 from favorites fav where fav.user_id = ${userId} and fav.facility_id = f.id)` : sql`false`} as is_favorite,
             o.free_spaces, o.status::text as occ_status, o.observed_at
      from parking_facilities f
      left join facility_occupancy o on o.facility_id = f.id
      where f.id = ${id} and f.is_active`);
    const row = result.rows[0];
    if (!row) throw AppError.notFound('Parkhaus nicht gefunden');

    const [tariffs, [source]] = await Promise.all([
      this.db
        .select({
          label: facilityTariffs.label,
          amount: facilityTariffs.amount,
          currency: facilityTariffs.currency,
          unit: facilityTariffs.unit,
          notes: facilityTariffs.notes,
          asOf: facilityTariffs.asOf,
          sourceUrl: facilityTariffs.sourceUrl,
        })
        .from(facilityTariffs)
        .where(eq(facilityTariffs.facilityId, id))
        .orderBy(asc(facilityTariffs.position), asc(facilityTariffs.createdAt)),
      this.db
        .select({ name: dataSources.name, license: dataSources.license, attribution: dataSources.attribution })
        .from(dataSources)
        .where(eq(dataSources.id, row.source_id)),
    ]);

    return {
      id: row.id,
      kind: 'PUBLIC_PARKING',
      name: row.name,
      operator: row.operator,
      facilityType: row.facility_type,
      street: row.street,
      postalCode: row.postal_code,
      city: row.city,
      lat: Number(row.lat),
      lng: Number(row.lng),
      capacity: row.capacity,
      openingHours: row.opening_hours,
      hasEvCharging: row.has_ev_charging,
      maxHeightCm: row.max_height_cm,
      website: row.website,
      occupancy: this.occupancy(row),
      tariffs: tariffs.map((t) => ({ label: t.label, amount: t.amount, unit: t.unit, notes: t.notes, currency: t.currency.trim() as CurrencyCode })),
      tariffsAsOf: tariffs.map((t) => t.asOf).filter(Boolean).sort().at(0) ?? null,
      tariffsSourceUrl: tariffs.find((t) => t.sourceUrl)?.sourceUrl ?? null,
      source: source ?? { name: 'Unbekannt', license: 'unbekannt', attribution: null },
      rating: { avg: row.rating_avg === null ? null : Number(row.rating_avg), count: row.rating_count ?? 0 },
      isFavorite: !!row.is_favorite,
    };
  }
}
