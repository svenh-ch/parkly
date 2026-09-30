import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dataSources, regions } from '../src/db/schema';
import { SwisstopoGeocoder, type GeocodingProvider } from '../src/adapters/geocoding';
import { FacilityService, PLS_SOURCE_KEY } from '../src/services/facility-service';
import { createTestApp, hasTestDb, truncateAll } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('swisstopo-Vorschläge', () => {
  it('liefert Adressen und Orte ohne HTML', async () => {
    const fetchImpl = vi.fn(async (url: URL) => {
      expect(url.searchParams.get('searchText')).toBe('Bahnhofstrasse');
      return Response.json({
        results: [
          { id: 1, attrs: { lat: 47.372, lon: 8.539, label: '<b>Bahnhofstrasse 1</b> 8001 Zürich', origin: 'address' } },
          { id: 2, attrs: { lat: 47.17, lon: 8.51, label: '<b>Zug</b> (ZG)', origin: 'gg25' } },
          { id: 3, attrs: { label: 'kaputt' } },
        ],
      });
    }) as unknown as typeof fetch;
    const items = await new SwisstopoGeocoder(fetchImpl).suggest('Bahnhofstrasse', 8);
    expect(items).toEqual([
      { id: 'swisstopo:1', kind: 'ADDRESS', label: 'Bahnhofstrasse 1 8001 Zürich', detail: null, lat: 47.372, lng: 8.539 },
      { id: 'swisstopo:2', kind: 'PLACE', label: 'Zug (ZG)', detail: 'Gemeinde', lat: 47.17, lng: 8.51 },
    ]);
  });
});

describe.skipIf(!hasTestDb)('Suche und "In deiner Nähe"', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  const geocoder: GeocodingProvider = {
    geocode: async () => null,
    suggest: vi.fn(async () => [
      { id: 'swisstopo:9', kind: 'ADDRESS' as const, label: 'Hardturmstrasse 1 8005 Zürich', detail: null, lat: 47.39, lng: 8.51 },
    ]),
  };

  beforeAll(async () => {
    t = await createTestApp({ geocoder });
    await truncateAll(t.db);
    await t.db.insert(regions).values({
      slug: 'zuerich',
      name: 'Zürich',
      countryCode: 'CH',
      currency: 'CHF',
      timezone: 'Europe/Zurich',
      center: { x: 8.54, y: 47.37 },
      minLat: '47.32',
      minLng: '8.44',
      maxLat: '47.44',
      maxLng: '8.63',
      isActive: true,
    });
    await t.db.insert(dataSources).values({ key: PLS_SOURCE_KEY, name: 'PLS', license: 'CC0-1.0' });
    await new FacilityService(t.db).importPlsLocations(path.join(here, '../data/zuerich-parkleitsystem.geojson'));
  });
  afterAll(async () => {
    await t.close();
  });

  it('findet Parkhäuser nach Name und Orte über den Geocoder', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/search/places?q=Hard' });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items[0]).toMatchObject({ type: 'PARKING', label: 'Parkhaus Hardau II', parking: { kind: 'PUBLIC_PARKING' } });
    expect(items.at(-1)).toMatchObject({ type: 'ADDRESS', label: 'Hardturmstrasse 1 8005 Zürich', parking: null });
  });

  it('liefert Parkplatz-Treffer auch, wenn der Geocoder ausfällt', async () => {
    vi.mocked(geocoder.suggest!).mockRejectedValueOnce(new Error('offline'));
    const items = (await t.app.inject({ method: 'GET', url: '/v1/search/places?q=Accu' })).json().items;
    expect(items.map((i: { label: string }) => i.label)).toEqual(['Parkhaus Accu']);
  });

  it('validiert die Eingabe', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/v1/search/places?q=a' })).statusCode).toBe(400);
  });

  it('zeigt auch weit weg (z. B. in Zug) die nächsten Parkhäuser statt einer leeren Liste', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/nearby?lat=47.1662&lng=8.5155&limit=5' });
    const items = res.json().items as { distanceMeters: number }[];
    expect(items).toHaveLength(5);
    expect(items[0]!.distanceMeters).toBeGreaterThan(15_000);
  });
});
