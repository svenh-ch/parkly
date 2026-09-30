import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addresses, dataSources, parkingSpots, regions, users } from '../src/db/schema';
import { parsePlsFeed } from '../src/adapters/parking-data/zuerich-pls';
import { FacilityService, PLS_SOURCE_KEY } from '../src/services/facility-service';
import { createTestApp, hasTestDb, truncateAll } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const zurich = { minLng: 8.44, minLat: 47.32, maxLng: 8.63, maxLat: 47.44 };

describe.skipIf(!hasTestDb)('Karte: Parkhäuser, Belegung, private Plätze', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let facilities: FacilityService;

  beforeAll(async () => {
    t = await createTestApp();
    await truncateAll(t.db);
    const [region] = await t.db
      .insert(regions)
      .values({
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
      })
      .returning();
    await t.db.insert(dataSources).values({ key: PLS_SOURCE_KEY, name: 'Parkleitsystem', license: 'CC0-1.0' });

    facilities = new FacilityService(t.db);
    const { upserted } = await facilities.importPlsLocations(path.join(here, '../data/zuerich-parkleitsystem.geojson'));
    expect(upserted).toBeGreaterThan(30);
    // zweiter Import darf keine Duplikate erzeugen
    await facilities.importPlsLocations(path.join(here, '../data/zuerich-parkleitsystem.geojson'));

    // ein aktiver privater Parkplatz in Oerlikon
    const [host] = await t.db.insert(users).values({ authUserId: crypto.randomUUID(), email: 'h@example.ch' }).returning();
    const [address] = await t.db
      .insert(addresses)
      .values({ street: 'Schaffhauserstrasse', postalCode: '8050', city: 'Zürich', countryCode: 'CH', location: { x: 8.5452, y: 47.4108 } })
      .returning();
    await t.db.insert(parkingSpots).values({
      hostId: host!.id,
      regionId: region!.id,
      addressId: address!.id,
      location: { x: 8.5452, y: 47.4108 },
      approxLocation: { x: 8.5461, y: 47.4113 },
      title: 'Privatparkplatz Zürich Oerlikon',
      spotType: 'OUTDOOR',
      status: 'ACTIVE',
      priceDaily: 2500,
      priceMonthly: 35000,
      currency: 'CHF',
    });
  });

  afterAll(async () => {
    await t.close();
  });

  const getMap = (q: Record<string, string | number>) =>
    t.app.inject({ method: 'GET', url: '/v1/map', query: Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])) });

  it('liefert einzelne Pins in der Stadtansicht, ohne Login', async () => {
    const res = await getMap({ ...zurich, zoom: 13 });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('items');
    const kinds = new Set(body.items.map((i: { kind: string }) => i.kind));
    expect(kinds).toEqual(new Set(['PUBLIC_PARKING', 'PRIVATE_MARKETPLACE_PARKING']));

    const spot = body.items.find((i: { kind: string }) => i.kind === 'PRIVATE_MARKETPLACE_PARKING');
    expect(spot.price).toEqual({ amount: 2500, unit: 'DAY', currency: 'CHF' });
    // nur die ungefähre Position wird ausgeliefert
    expect(spot.lat).toBeCloseTo(47.4113, 4);
    expect(spot.lng).toBeCloseTo(8.5461, 4);
  });

  it('fasst Pins in der Weltansicht zu Clustern zusammen', async () => {
    const res = await getMap({ minLng: -180, minLat: -85, maxLng: 180, maxLat: 85, zoom: 1 });
    const body = res.json();
    expect(body.mode).toBe('clusters');
    const total = body.clusters.reduce((s: number, c: { count: number }) => s + c.count, 0);
    expect(total).toBe(35);
    expect(body.clusters.length).toBeLessThan(5);
  });

  it('liefert leere Ergebnisse ausserhalb Zürichs statt Fehler', async () => {
    const res = await getMap({ minLng: -74.1, minLat: 40.6, maxLng: -73.8, maxLat: 40.9, zoom: 12 });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });

  it('filtert nach Art', async () => {
    const res = await getMap({ ...zurich, zoom: 13, kinds: 'PRIVATE_MARKETPLACE_PARKING' });
    expect(res.json().items).toHaveLength(1);
  });

  it('übernimmt die Echtzeit-Belegung aus dem Parkleitsystem', async () => {
    const xml = readFileSync(path.join(here, 'fixtures/pls-feed.xml'), 'utf8');
    const now = new Date();
    const entries = parsePlsFeed(xml).map((e) => ({ ...e, observedAt: now }));
    const result = await facilities.applyPlsOccupancy(entries);
    expect(result.updated).toBe(4);
    expect(result.unknown).toEqual(['Parkhaus Opéra']);

    const body = (await getMap({ ...zurich, zoom: 13 })).json();
    const accu = body.items.find((i: { name: string }) => i.name === 'Parkhaus Accu');
    expect(accu.occupancy).toMatchObject({ freeSpaces: 171, status: 'OPEN', isLive: true });

    const detail = (await t.app.inject({ method: 'GET', url: `/v1/facilities/${accu.id}` })).json();
    expect(detail).toMatchObject({
      name: 'Parkhaus Accu',
      street: 'Otto-Schütz-Weg',
      website: 'https://www.pls-zh.ch/parkhaus/accu.jsp?pid=accu',
      capacity: 194,
      source: { license: 'CC0-1.0' },
    });
  });

  it('sortiert Parkplätze in der Nähe nach Distanz', async () => {
    // Standort: Bahnhof Oerlikon
    const res = await t.app.inject({ method: 'GET', url: '/v1/nearby?lat=47.4115&lng=8.5442&radius=1500&limit=5' });
    const items = res.json().items as { distanceMeters: number; name: string }[];
    expect(items.length).toBe(5);
    const distances = items.map((i) => i.distanceMeters);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(distances.every((d) => d <= 1500)).toBe(true);
  });

  it('validiert Parameter und unbekannte IDs', async () => {
    expect((await getMap({ ...zurich })).statusCode).toBe(400);
    expect((await getMap({ ...zurich, zoom: 13, kinds: 'FOO' })).statusCode).toBe(400);
    const res = await t.app.inject({ method: 'GET', url: `/v1/facilities/${crypto.randomUUID()}` });
    expect(res.statusCode).toBe(404);
  });
});
