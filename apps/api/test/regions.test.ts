import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { facilityTariffs, parkingFacilities, regions } from '../src/db/schema';
import { FacilityService, type RegionFile } from '../src/services/facility-service';
import { parseLuzernPls, parseZugPls } from '../src/adapters/parking-data/central-switzerland';
import { OrsPoiSearch, OrsWalking, parsePelias, type PoiSearchProvider, type WalkingProvider } from '../src/adapters/places';
import { cleanGazetteer } from '../src/adapters/geocoding';
import { createTestApp, hasTestDb, makeToken, truncateAll } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = async (f: string) => JSON.parse(await readFile(path.join(here, '../data/regions', f), 'utf8')) as RegionFile;

describe('Echtzeit-Adapter Luzern/Zug', () => {
  it('liest den Luzerner Feed und markiert veraltete Werte', () => {
    const now = new Date('2026-09-30T00:20:00+02:00');
    const entries = parseLuzernPls(
      {
        status: 'success',
        data: {
          parkings: {
            AP04: { description: 'Allmend/Messe P2', vacancy: 0, datestamp: '2023-03-13T20:45:23+01:00', capacity: 0, maintenance: false, opened: true },
            SP02: { description: 'Altstadt', vacancy: 366, datestamp: '2026-09-30T00:13:56+02:00', capacity: 456, maintenance: false, opened: true },
            NP08: { description: 'Casino-Palace', vacancy: 5, datestamp: '2026-09-30T00:14:54+02:00', capacity: 250, maintenance: false, opened: false },
          },
        },
      },
      now,
    );
    expect(entries).toEqual([
      expect.objectContaining({ key: 'AP04', freeSpaces: null, status: 'UNKNOWN' }),
      expect.objectContaining({ key: 'SP02', freeSpaces: 366, status: 'OPEN' }),
      expect.objectContaining({ key: 'NP08', status: 'CLOSED' }),
    ]);
  });

  it('liest die Liste von pls-zug.ch', () => {
    const html = `<ul>
      <li data-id="2176" style="x"><div class="free">170</div><div class="info"><h2>
          Altstadt Casino</h2><p>Zugerbergstrasse<br><span class="green">FREI</span></p></div></li>
      <li data-id="2181" style="x"><div class="free">161</div><div class="info"><h2>
          Coop City</h2><p>Bundesplatz 11 - 17<br><span class="red">GESCHLOSSEN</span></p></div></li>
      <li data-id="2190" style="x"><div class="free">471</div><div class="info"><h2>
          Metalli / Parkhotel</h2><p>Industriestrasse 15b<br><span class="green">FREI</span></p></div></li></ul>`;
    expect(parseZugPls(html).map((e) => [e.key, e.freeSpaces, e.status])).toEqual([
      ['Altstadt Casino', 170, 'OPEN'],
      ['Coop City', 0, 'CLOSED'],
      ['Metalli / Parkhotel', 471, 'OPEN'],
    ]);
  });
});

describe('Orte und Fusswege (openrouteservice)', () => {
  const pelias = {
    features: [
      { geometry: { coordinates: [8.517481, 47.173035] }, properties: { gid: 'openstreetmap:venue:way/29458549', layer: 'venue', name: 'Metalli', locality: 'Zug' } },
      { geometry: { coordinates: [8.517386, 47.172472] }, properties: { gid: 'openstreetmap:venue:node/663436665', name: 'Metalli Apotheke', street: 'Industriestrasse', housenumber: '13b', locality: 'Zug' } },
      { properties: { name: 'kaputt' } },
    ],
  };

  it('normalisiert Pelias-Treffer', () => {
    expect(parsePelias(pelias)).toEqual([
      { id: 'ors:openstreetmap:venue:way/29458549', label: 'Metalli', detail: 'Zug', lat: 47.173035, lng: 8.517481 },
      { id: 'ors:openstreetmap:venue:node/663436665', label: 'Metalli Apotheke', detail: 'Industriestrasse 13b, Zug', lat: 47.172472, lng: 8.517386 },
    ]);
  });

  it('fragt nur grob mit Position und cacht Ergebnisse', async () => {
    const fetchImpl = vi.fn(async (url: URL) => {
      expect(url.searchParams.get('focus.point.lat')).toBe('47.17');
      expect(url.searchParams.get('boundary.country')).toBe('CH');
      expect(url.searchParams.get('layers')).toBe('venue');
      return Response.json(pelias);
    }) as unknown as typeof fetch;
    const s = new OrsPoiSearch('K', fetchImpl, 'https://ors.test');
    await s.suggest('Metalli Zug', 6, { lat: 47.1712345, lng: 8.5123 });
    const again = await s.suggest('metalli zug', 6, { lat: 47.1698, lng: 8.5149 });
    expect(again).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('berechnet Fusswege über die Matrix', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.sources).toEqual([0]);
      expect(body.destinations).toEqual([1, 2]);
      return Response.json({ distances: [[560.07, null]], durations: [[403.24, null]] });
    }) as unknown as typeof fetch;
    const w = new OrsWalking('K', fetchImpl, 'https://ors.test');
    expect(await w.walk({ lat: 47.37, lng: 8.53 }, [{ lat: 47.36, lng: 8.53 }, { lat: 47.37, lng: 8.52 }])).toEqual([
      { meters: 560, seconds: 403 },
      null,
    ]);
  });

  it('räumt swisstopo-Namen auf', () => {
    expect(cleanGazetteer('Gebaeude Einzelhaus Stadion Letzigrund (ZH) - Zürich')).toEqual({ label: 'Stadion Letzigrund', detail: 'Zürich (ZH)' });
    expect(cleanGazetteer('Gebaeude Kultur- und Kongresszentrum Luzern KKL (LU) - Luzern').label).toBe('Kultur- und Kongresszentrum Luzern KKL');
  });
});

describe.skipIf(!hasTestDb)('Regionen Zug und Luzern', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  const pois: PoiSearchProvider = {
    suggest: vi.fn(async () => [
      { id: 'ors:1', label: 'Metalli', detail: 'Zug', lat: 47.173035, lng: 8.517481 },
      { id: 'ors:2', label: 'Metalli Apotheke', detail: 'Industriestrasse 13b, Zug', lat: 47.172472, lng: 8.517386 },
    ]),
  };
  const walking: WalkingProvider = {
    // Fussweg absichtlich nicht in Luftlinien-Reihenfolge: der zweitnächste ist zu Fuss am nächsten
    walk: vi.fn(async (_from: unknown, to: unknown[]) => to.map((_: unknown, i: number) => ({ meters: i === 1 ? 50 : 300 + i * 100, seconds: i === 1 ? 40 : 240 + i * 60 }))),
  };

  beforeAll(async () => {
    t = await createTestApp({ pois, walking });
    await truncateAll(t.db);
    const svc = new FacilityService(t.db);
    await svc.importRegion(await load('zug.json'));
    await svc.importRegion(await load('luzern.json'));
  });
  afterAll(async () => {
    await t?.close();
  });

  it('legt Regionen, Parkhäuser, Parkplätze und Tarife an (idempotent)', async () => {
    const count = async () => Number((await t.db.execute<{ n: string }>(sql`select count(*) as n from parking_facilities where is_active`)).rows[0]!.n);
    const before = await count();
    expect(before).toBe(60);
    await new FacilityService(t.db).importRegion(await load('zug.json'));
    expect(await count()).toBe(before);
    const rs = await t.db.select({ slug: regions.slug, active: regions.isActive }).from(regions);
    expect(rs.map((r) => r.slug).sort()).toEqual(['luzern', 'zug']);
    const [casino] = await t.db.select().from(parkingFacilities).where(eq(parkingFacilities.externalId, 'zg-pls-altstadt-casino'));
    const tariffs = await t.db.select().from(facilityTariffs).where(eq(facilityTariffs.facilityId, casino!.id));
    expect(tariffs.map((x) => [x.label, x.amount, x.unit])).toContainEqual(['Bis 1 Std.', 150, 'HOUR']);
  });

  it('zeigt Zuger und Luzerner Parkhäuser auf der Karte, ohne Live-Daten', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/map?minLng=8.50&minLat=47.16&maxLng=8.53&maxLat=47.18&zoom=15' });
    const items = res.json().items as { name: string; occupancy: unknown }[];
    expect(items.map((i) => i.name)).toEqual(expect.arrayContaining(['Parkhaus Metalli / Parkhotel', 'Parkhaus Neustadtplatz', 'Parkplatz Theilerplatz']));
    expect(items.every((i) => i.occupancy === null)).toBe(true);
    const lu = await t.app.inject({ method: 'GET', url: '/v1/nearby?lat=47.0502&lng=8.3093&limit=3' });
    expect(lu.json().items[0].name).toMatch(/Bahnhofparking|Schweizerhof|Flora/);
  });

  it('übernimmt Echtzeit-Belegung über den liveKey', async () => {
    const res = await new FacilityService(t.db).applyLiveOccupancy('luzern', parseLuzernPls({
      data: { parkings: { SP02: { vacancy: 12, capacity: 456, opened: true, datestamp: new Date().toISOString() }, XX: { vacancy: 1, capacity: 1 } } },
    }));
    expect(res).toEqual({ updated: 1, unknown: ['XX'] });
    const [altstadt] = await t.db.select({ id: parkingFacilities.id }).from(parkingFacilities).where(eq(parkingFacilities.externalId, 'lu-88'));
    const detail = (await t.app.inject({ method: 'GET', url: `/v1/facilities/${altstadt!.id}` })).json();
    expect(detail.occupancy).toMatchObject({ freeSpaces: 12, isLive: true });
    expect(detail.source.attribution).toContain('Stadt Luzern');
  });

  it('sortiert "Parken bei …" nach Gehdistanz', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/nearby?lat=47.1730&lng=8.5175&limit=4&walk=true' });
    const items = res.json().items as { walkMeters: number; distanceMeters: number }[];
    expect(items).toHaveLength(4);
    expect(items[0]!.walkMeters).toBe(50);
    expect(items.map((i) => i.walkMeters)).toEqual([...items.map((i) => i.walkMeters)].sort((a, b) => a - b));
  });

  it('zeigt Tarife mit Stand und Quelle; nur Admins dürfen sie ändern', async () => {
    const [casino] = await t.db.select({ id: parkingFacilities.id }).from(parkingFacilities).where(eq(parkingFacilities.externalId, 'zg-pls-altstadt-casino'));
    const detail = (await t.app.inject({ method: 'GET', url: `/v1/facilities/${casino!.id}` })).json();
    expect(detail.tariffs[0]).toMatchObject({ label: 'Bis 1 Std.', amount: 150, notes: null });
    expect(detail.tariffsAsOf).toBe('2026-09-30');
    expect(detail.tariffsSourceUrl).toContain('stadtzug.ch');

    const token = await makeToken({ email: 'admin@example.ch' });
    const body = { asOf: '2026-10-01', sourceUrl: 'https://example.ch/tarife', items: [{ label: 'Pro Stunde', amount: 200, unit: 'HOUR' }] };
    const put = () => t.app.inject({ method: 'PUT', url: `/v1/admin/facilities/${casino!.id}/tariffs`, headers: { authorization: `Bearer ${token}` }, payload: body });
    expect((await put()).statusCode).toBe(403);
    const me = (await t.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${token}` } })).json();
    await t.db.execute(sql`insert into user_roles (user_id, role) values (${me.id}, 'ADMIN')`);
    expect((await put()).statusCode).toBe(204);
    const after = (await t.app.inject({ method: 'GET', url: `/v1/facilities/${casino!.id}` })).json();
    expect(after.tariffs).toEqual([{ label: 'Pro Stunde', amount: 200, unit: 'HOUR', currency: 'CHF', notes: null }]);
    expect(after.tariffsAsOf).toBe('2026-10-01');
  });

  it('findet Geschäfte und Parkhäuser in einer Suche', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/search/places?q=Metalli&lat=47.17&lng=8.51' });
    const items = res.json().items as { type: string; label: string }[];
    expect(items[0]).toMatchObject({ type: 'PARKING', label: 'Parkhaus Metalli / Parkhotel' });
    expect(items.filter((i) => i.type === 'POI').map((i) => i.label)).toEqual(['Metalli', 'Metalli Apotheke']);
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(pois.suggest).toHaveBeenCalledWith('Metalli', 6, { lat: 47.17, lng: 8.51 });
  });
});
