import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { dataSources, facilityOccupancy, parkingFacilities, regions } from '../src/db/schema';
import { SwisstopoGeocoder, type GeocodingProvider } from '../src/adapters/geocoding';
import { newPlsSyncState, runPlsSyncOnce } from '../src/jobs/pls-sync';
import { FacilityService, PLS_SOURCE_KEY } from '../src/services/facility-service';
import { createTestApp, hasTestDb, truncateAll } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const feed = readFileSync(path.join(here, 'fixtures/pls-feed.xml'), 'utf8');
const log = { info: vi.fn(), warn: vi.fn() };
const fetchFeed = (async () => new Response(feed, { status: 200 })) as unknown as typeof fetch;

describe('swisstopo-Geocoder', () => {
  it('bevorzugt Adressen und prüft das Gebiet', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        results: [
          { attrs: { lat: 46.0, lon: 7.0, label: 'Irgendwo <b>weit weg</b>', origin: 'address' } },
          { attrs: { lat: 47.365, lon: 8.547, label: 'Opernhaus', origin: 'gazetteer' } },
          { attrs: { lat: 47.3651, lon: 8.5468, label: '<b>Schillerstrasse 5</b> 8001 Zürich', origin: 'address' } },
        ],
      }),
    ) as unknown as typeof fetch;
    const g = new SwisstopoGeocoder(fetchImpl);
    const hit = await g.geocode('Schillerstrasse 5 Zürich', { minLat: 47.3, minLng: 8.4, maxLat: 47.5, maxLng: 8.7 });
    expect(hit).toEqual({ lat: 47.3651, lng: 8.5468, label: 'Schillerstrasse 5 8001 Zürich' });
  });

  it('liefert null ohne passenden Treffer', async () => {
    const g = new SwisstopoGeocoder((async () => Response.json({ results: [] })) as unknown as typeof fetch);
    expect(await g.geocode('nichts')).toBeNull();
  });
});

describe.skipIf(!hasTestDb)('Parkleitsystem-Sync mit automatischer Verortung', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let facilities: FacilityService;

  beforeAll(async () => {
    t = await createTestApp();
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
    facilities = new FacilityService(t.db);
    await facilities.importPlsLocations(path.join(here, '../data/zuerich-parkleitsystem.geojson'));
  });
  afterAll(async () => {
    await t.close();
  });

  it('legt unbekannte Parkhäuser per Geocoding an und versucht es nicht sofort erneut', async () => {
    const geocoder: GeocodingProvider = { geocode: vi.fn(async () => ({ lat: 47.3651, lng: 8.5468, label: 'Schillerstrasse 5' })) };
    const state = newPlsSyncState();

    const r1 = await runPlsSyncOnce({ facilities, geocoder, log, fetchImpl: fetchFeed }, state);
    expect(r1.created).toEqual(['Parkhaus Opéra']);
    expect(r1.stillUnknown).toEqual([]);
    expect(geocoder.geocode).toHaveBeenCalledWith('Schillerstrasse 5 Zürich', expect.objectContaining({ minLat: 47.32 }));

    const [opera] = await t.db.select().from(parkingFacilities).where(eq(parkingFacilities.name, 'Parkhaus Opéra'));
    expect(opera).toMatchObject({ street: 'Schillerstrasse 5', city: 'Zürich' });
    const [occ] = await t.db.select().from(facilityOccupancy).where(eq(facilityOccupancy.facilityId, opera!.id));
    expect(occ?.status).toBe('UNKNOWN');

    await runPlsSyncOnce({ facilities, geocoder, log, fetchImpl: fetchFeed }, state);
    expect(geocoder.geocode).toHaveBeenCalledTimes(1);
  });

  it('meldet Parkhäuser, die nicht verortet werden können', async () => {
    await t.db.delete(parkingFacilities).where(eq(parkingFacilities.name, 'Parkhaus Opéra'));
    const geocoder: GeocodingProvider = { geocode: vi.fn(async () => null) };
    const r = await runPlsSyncOnce({ facilities, geocoder, log, fetchImpl: fetchFeed }, newPlsSyncState());
    expect(r.stillUnknown).toEqual(['Parkhaus Opéra']);
    expect(geocoder.geocode).toHaveBeenCalledTimes(2); // Adresse, dann Name
  });
});
