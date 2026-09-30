import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { routeSchema, type Route } from '@parking/shared';
import {
  MapboxRouting,
  OpenRouteServiceRouting,
  RoutingError,
  parseMapboxResponse,
  parseOrsResponse,
  type RoutingProvider,
} from '../src/adapters/routing';
import { createTestApp, hasTestDb, makeToken } from './helpers';

const orsBody = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        summary: { distance: 1520.4, duration: 180.2 },
        segments: [
          {
            distance: 1520.4,
            duration: 180.2,
            steps: [
              { distance: 400, duration: 50, type: 11, instruction: 'Fahre Richtung Osten auf Baarerstrasse', name: 'Baarerstrasse', way_points: [0, 2] },
              { distance: 600, duration: 70, type: 7, instruction: 'Nimm im Kreisverkehr die 2. Ausfahrt', name: '-', exit_number: 2, way_points: [2, 3] },
              { distance: 520.4, duration: 60.2, type: 1, instruction: 'Biege rechts ab auf Seestrasse', name: 'Seestrasse', way_points: [3, 4] },
              { distance: 0, duration: 0, type: 10, instruction: 'Ankunft', name: '-', way_points: [4, 4] },
            ],
          },
        ],
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [8.51, 47.17],
          [8.512, 47.17],
          [8.514, 47.17],
          [8.514, 47.172],
          [8.516, 47.172],
        ],
      },
    },
  ],
};

describe('openrouteservice-Adapter', () => {
  it('normalisiert Geometrie und Schritte', () => {
    const r = parseOrsResponse(orsBody);
    expect(routeSchema.parse(r)).toBeTruthy();
    expect(r.coordinates[0]).toEqual([47.17, 8.51]);
    expect(r.steps.map((s) => s.type)).toEqual(['DEPART', 'ROUNDABOUT', 'RIGHT', 'ARRIVE']);
    expect(r.steps[1]).toMatchObject({ exitNumber: 2, streetName: null, startIndex: 2 });
    expect(r.steps[2]!.streetName).toBe('Seestrasse');
    expect(r.distanceMeters).toBe(1520.4);
    expect(r.attribution).toContain('OpenStreetMap');
  });

  it('sendet Key im Header, Koordinaten als lng/lat und Deutsch', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://ors.test/v2/directions/driving-car/geojson');
      expect((init.headers as Record<string, string>).Authorization).toBe('KEY');
      const body = JSON.parse(String(init.body));
      expect(body.coordinates).toEqual([
        [8.51, 47.17],
        [8.516, 47.172],
      ]);
      expect(body.language).toBe('de');
      return Response.json(orsBody);
    }) as unknown as typeof fetch;
    const r = await new OpenRouteServiceRouting('KEY', fetchImpl, 'https://ors.test').route(
      { lat: 47.17, lng: 8.51 },
      { lat: 47.172, lng: 8.516 },
    );
    expect(r.steps).toHaveLength(4);
  });

  it('übersetzt Fehler', async () => {
    const make = (status: number, body: unknown) =>
      new OpenRouteServiceRouting('K', (async () => Response.json(body, { status })) as unknown as typeof fetch, 'https://x.test');
    const a = { lat: 47, lng: 8 };
    await expect(make(404, { error: { code: 2009, message: 'x' } }).route(a, a)).rejects.toMatchObject({ kind: 'NOT_FOUND' });
    await expect(make(403, { error: 'Access to this API has been disallowed' }).route(a, a)).rejects.toMatchObject({ kind: 'UNAUTHORIZED' });
    await expect(make(429, {}).route(a, a)).rejects.toMatchObject({ kind: 'RATE_LIMITED' });
    await expect(make(502, {}).route(a, a)).rejects.toBeInstanceOf(RoutingError);
  });
});

describe('Mapbox-Adapter', () => {
  it('normalisiert Manöver und Startindizes', async () => {
    const body = {
      code: 'Ok',
      routes: [
        {
          distance: 900,
          duration: 100,
          geometry: { coordinates: [[8.5, 47.1], [8.501, 47.1], [8.502, 47.1], [8.502, 47.101]] },
          legs: [
            {
              steps: [
                { distance: 200, duration: 20, name: 'A', maneuver: { type: 'depart' }, geometry: { coordinates: [[8.5, 47.1], [8.501, 47.1], [8.502, 47.1]] } },
                { distance: 700, duration: 80, name: 'B', maneuver: { type: 'turn', modifier: 'left' }, geometry: { coordinates: [[8.502, 47.1], [8.502, 47.101]] } },
                { distance: 0, duration: 0, name: '', maneuver: { type: 'arrive' }, geometry: { coordinates: [[8.502, 47.101], [8.502, 47.101]] } },
              ],
            },
          ],
        },
      ],
    };
    const r = parseMapboxResponse(body);
    expect(r.steps.map((s) => [s.type, s.startIndex])).toEqual([
      ['DEPART', 0],
      ['LEFT', 2],
      ['ARRIVE', 3],
    ]);
    const fetchImpl = vi.fn(async (url: URL) => {
      expect(url.pathname).toBe('/directions/v5/mapbox/driving-traffic/8.5,47.1;8.502,47.101');
      expect(url.searchParams.get('language')).toBe('de');
      return Response.json(body);
    }) as unknown as typeof fetch;
    await new MapboxRouting('tok', fetchImpl).route({ lat: 47.1, lng: 8.5 }, { lat: 47.101, lng: 8.502 });
  });
});

describe.skipIf(!hasTestDb)('POST /v1/route', () => {
  const from = { lat: 47.17, lng: 8.51 };
  const to = { lat: 47.172, lng: 8.516 };
  let token: string;
  const provider: RoutingProvider & { route: ReturnType<typeof vi.fn> } = {
    name: 'fake',
    route: vi.fn(async (): Promise<Route> => parseOrsResponse(orsBody)),
  };
  let withRouting: Awaited<ReturnType<typeof createTestApp>>;
  let without: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    token = await makeToken();
    withRouting = await createTestApp({ routing: provider });
    without = await createTestApp({ routing: null });
  });
  afterAll(async () => {
    await withRouting?.close();
    await without?.close();
  });

  const post = (t: typeof withRouting, body: unknown, auth = true) =>
    t.app.inject({
      method: 'POST',
      url: '/v1/route',
      headers: auth ? { authorization: `Bearer ${token}` } : {},
      payload: body as object,
    });

  it('verlangt Login', async () => {
    expect((await post(withRouting, { from, to }, false)).statusCode).toBe(401);
  });

  it('liefert die Route und cached nicht', async () => {
    const res = await post(withRouting, { from, to });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json().steps[0].type).toBe('DEPART');
    expect(provider.route).toHaveBeenCalledWith(from, to);
  });

  it('meldet fehlende Einrichtung verständlich', async () => {
    const res = await post(without, { from, to });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.details.reason).toBe('ROUTING_NOT_CONFIGURED');
  });

  it('prüft Eingaben und Distanz', async () => {
    expect((await post(withRouting, { from, to: { lat: 200, lng: 8 } })).statusCode).toBe(400);
    expect((await post(withRouting, { from, to: from })).json().error.code).toBe('ROUTE_NOT_FOUND');
    expect((await post(withRouting, { from, to: { lat: 40.7, lng: -74 } })).statusCode).toBe(422);
  });

  it('übersetzt Anbieterfehler', async () => {
    provider.route.mockRejectedValueOnce(new RoutingError('NOT_FOUND', 'x'));
    expect((await post(withRouting, { from, to })).json().error.code).toBe('ROUTE_NOT_FOUND');
    provider.route.mockRejectedValueOnce(new RoutingError('UNAUTHORIZED', 'x'));
    const res = await post(withRouting, { from, to });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.details.reason).toBe('ROUTING_KEY_INVALID');
  });
});

describe('openrouteservice: echte Antwort (gekürzt, 30.09.2026, Zug -> Zürich)', () => {
  it('verarbeitet Namen mit Strassennummern und "keep"-Manöver', () => {
    const coords = Array.from({ length: 420 }, (_, i) => [8.515 + i * 0.00005, 47.166 + i * 0.0005] as [number, number]);
    const r = parseOrsResponse({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            segments: [
              {
                distance: 35513,
                duration: 1996.3,
                steps: [
                  { distance: 479.1, duration: 79.3, type: 11, instruction: 'Weiter nördlich auf Kolinplatz, 25', name: 'Kolinplatz, 25', way_points: [0, 12] },
                  { distance: 2059.5, duration: 228.2, type: 13, instruction: 'rechts halten auf Baarerstrasse', name: 'Baarerstrasse', way_points: [12, 50] },
                  { distance: 798.5, duration: 61, type: 0, instruction: 'Biegen Sie links auf Südstrasse ab', name: 'Südstrasse', way_points: [50, 58] },
                  { distance: 4830.1, duration: 242.8, type: 12, instruction: 'links halten', name: '-', way_points: [58, 123] },
                  { distance: 63.6, duration: 15.3, type: 1, instruction: 'Biegen Sie rechts auf Bahnhofstrasse ab', name: 'Bahnhofstrasse', way_points: [123, 419] },
                  { distance: 0, duration: 0, type: 10, instruction: 'Sie erreichen Bahnhofstrasse (links)', name: '-', way_points: [419, 419] },
                ],
              },
            ],
            way_points: [0, 419],
            summary: { distance: 35513, duration: 1996.3 },
          },
          geometry: { type: 'LineString', coordinates: coords },
        },
      ],
    });
    expect(r.steps.map((s) => s.type)).toEqual(['DEPART', 'KEEP_RIGHT', 'LEFT', 'KEEP_LEFT', 'RIGHT', 'ARRIVE']);
    expect(r.steps[3]!.streetName).toBeNull();
    expect(r.steps.at(-1)!.startIndex).toBe(419);
    expect(r.durationSeconds).toBe(1996.3);
  });
});
