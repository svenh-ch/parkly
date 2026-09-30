import type { LatLng, ManeuverType, Route, RouteStep } from '@parking/shared';

/**
 * Routing-Port: Autoroute von A nach B mit Abbiege-Anweisungen.
 *
 * Adapter:
 *  - openrouteservice (HeiGIT, Heidelberg): Standard. Gratis-Plan 2000 Routen/Tag, 40/Minute,
 *    kommerzielle Nutzung erlaubt. Daten: OpenStreetMap (ODbL) -> Quellenangabe in der App.
 *  - Mapbox Directions: 100 000 Anfragen/Monat gratis, danach kostenpflichtig; mit Verkehrslage.
 *    Ergebnisse dürfen laut Mapbox Product Terms nicht gespeichert/gecacht werden (tun wir nicht).
 *  - Google Routes: NICHT verwendbar, solange die App Apple Maps anzeigt
 *    ("results displayed on a map must be shown on a Google Map").
 *
 * Datenschutz: Start und Ziel gehen nur an den Anbieter, werden bei uns weder gespeichert
 * noch geloggt (POST-Body, Logger protokolliert keine Bodies).
 */
export interface RoutingProvider {
  readonly name: string;
  route(from: LatLng, to: LatLng, signal?: AbortSignal): Promise<Route>;
}

export class RoutingError extends Error {
  constructor(
    public readonly kind: 'NOT_FOUND' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'RoutingError';
  }
}

function httpError(status: number, detail: string): RoutingError {
  if (status === 401 || status === 403) return new RoutingError('UNAUTHORIZED', `Routing-Key ungültig (HTTP ${status})`);
  if (status === 429) return new RoutingError('RATE_LIMITED', 'Routing-Kontingent erschöpft (HTTP 429)');
  return new RoutingError('UNAVAILABLE', `Routing-Dienst antwortet mit HTTP ${status}: ${detail.slice(0, 200)}`);
}

const cleanName = (n: unknown): string | null => {
  if (typeof n !== 'string') return null;
  const t = n.trim();
  return t && t !== '-' ? t : null;
};

// ─── openrouteservice ─────────────────────────────────────────────────────

/** ORS-Instruktionstypen: https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/instruction-types */
const ORS_TYPES: Record<number, ManeuverType> = {
  0: 'LEFT',
  1: 'RIGHT',
  2: 'SHARP_LEFT',
  3: 'SHARP_RIGHT',
  4: 'SLIGHT_LEFT',
  5: 'SLIGHT_RIGHT',
  6: 'STRAIGHT',
  7: 'ROUNDABOUT',
  8: 'EXIT_ROUNDABOUT',
  9: 'UTURN',
  10: 'ARRIVE',
  11: 'DEPART',
  12: 'KEEP_LEFT',
  13: 'KEEP_RIGHT',
};

interface OrsStep {
  distance?: number;
  duration?: number;
  type?: number;
  instruction?: string;
  name?: string;
  exit_number?: number;
  way_points?: [number, number];
}
interface OrsResponse {
  features?: {
    geometry?: { coordinates?: [number, number][] };
    properties?: {
      summary?: { distance?: number; duration?: number };
      segments?: { steps?: OrsStep[] }[];
    };
  }[];
  error?: { code?: number; message?: string } | string;
}

export function parseOrsResponse(raw: unknown): Route {
  const body = raw as OrsResponse;
  const feature = body.features?.[0];
  const coords = feature?.geometry?.coordinates;
  if (!feature || !coords || coords.length < 2) throw new RoutingError('NOT_FOUND', 'Keine Route gefunden');
  const steps: RouteStep[] = [];
  for (const segment of feature.properties?.segments ?? []) {
    for (const s of segment.steps ?? []) {
      const type = ORS_TYPES[s.type ?? -1] ?? 'STRAIGHT';
      // Zwischenziele (mehrere Segmente) nicht als Ankunft behandeln
      if (type === 'ARRIVE' && steps.length && steps[steps.length - 1]!.type === 'ARRIVE') steps.pop();
      steps.push({
        type,
        instruction: s.instruction ?? '',
        streetName: cleanName(s.name),
        exitNumber: typeof s.exit_number === 'number' && s.exit_number > 0 ? s.exit_number : null,
        distanceMeters: s.distance ?? 0,
        durationSeconds: s.duration ?? 0,
        startIndex: Math.min(s.way_points?.[0] ?? 0, coords.length - 1),
      });
    }
  }
  if (!steps.length || steps[steps.length - 1]!.type !== 'ARRIVE') {
    steps.push({
      type: 'ARRIVE',
      instruction: 'Ziel erreicht',
      streetName: null,
      exitNumber: null,
      distanceMeters: 0,
      durationSeconds: 0,
      startIndex: coords.length - 1,
    });
  }
  return {
    provider: 'openrouteservice',
    attribution: '© openrouteservice.org by HeiGIT | Kartendaten © OpenStreetMap-Mitwirkende',
    distanceMeters: feature.properties?.summary?.distance ?? 0,
    durationSeconds: feature.properties?.summary?.duration ?? 0,
    coordinates: coords.map(([lng, lat]) => [lat, lng] as [number, number]),
    steps,
  };
}

export class OpenRouteServiceRouting implements RoutingProvider {
  readonly name = 'openrouteservice';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = 'https://api.openrouteservice.org',
  ) {}

  async route(from: LatLng, to: LatLng, signal?: AbortSignal): Promise<Route> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/v2/directions/driving-car/geojson`, {
      method: 'POST',
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/geo+json, application/json',
      },
      body: JSON.stringify({
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
        language: 'de',
        units: 'm',
        instructions: true,
        geometry_simplify: false,
        // Start darf bis 350 m neben der Strasse liegen (z. B. Standort in einem Gebäude)
        radiuses: [350, 350],
      }),
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    let body: OrsResponse = {};
    try {
      body = JSON.parse(text) as OrsResponse;
    } catch {
      /* unten behandelt */
    }
    if (!res.ok) {
      const code = typeof body.error === 'object' ? body.error?.code : undefined;
      if (code === 2009 || code === 2010) throw new RoutingError('NOT_FOUND', 'Keine Route zu diesem Ziel gefunden');
      throw httpError(res.status, text);
    }
    return parseOrsResponse(body);
  }
}

// ─── Mapbox ───────────────────────────────────────────────────────────────

interface MapboxStep {
  distance?: number;
  duration?: number;
  name?: string;
  geometry?: { coordinates?: [number, number][] };
  maneuver?: { type?: string; modifier?: string; exit?: number; instruction?: string };
}
interface MapboxResponse {
  code?: string;
  message?: string;
  routes?: {
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: [number, number][] };
    legs?: { steps?: MapboxStep[] }[];
  }[];
}

function mapboxType(type = '', modifier = ''): ManeuverType {
  if (type === 'depart') return 'DEPART';
  if (type === 'arrive') return 'ARRIVE';
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') return 'ROUNDABOUT';
  if (type === 'exit roundabout' || type === 'exit rotary') return 'EXIT_ROUNDABOUT';
  if (type === 'merge') return 'MERGE';
  if (type === 'on ramp' || type === 'off ramp') return 'RAMP';
  if (type === 'fork') return modifier.includes('left') ? 'KEEP_LEFT' : 'KEEP_RIGHT';
  switch (modifier) {
    case 'uturn':
      return 'UTURN';
    case 'sharp right':
      return 'SHARP_RIGHT';
    case 'right':
      return 'RIGHT';
    case 'slight right':
      return 'SLIGHT_RIGHT';
    case 'sharp left':
      return 'SHARP_LEFT';
    case 'left':
      return 'LEFT';
    case 'slight left':
      return 'SLIGHT_LEFT';
    default:
      return 'STRAIGHT';
  }
}

export function parseMapboxResponse(raw: unknown): Route {
  const body = raw as MapboxResponse;
  const r = body.routes?.[0];
  const coords = r?.geometry?.coordinates;
  if (!r || !coords || coords.length < 2) throw new RoutingError('NOT_FOUND', 'Keine Route gefunden');
  const steps: RouteStep[] = [];
  let index = 0;
  for (const leg of r.legs ?? []) {
    for (const s of leg.steps ?? []) {
      steps.push({
        type: mapboxType(s.maneuver?.type, s.maneuver?.modifier),
        instruction: s.maneuver?.instruction ?? '',
        streetName: cleanName(s.name),
        exitNumber: typeof s.maneuver?.exit === 'number' ? s.maneuver.exit : null,
        distanceMeters: s.distance ?? 0,
        durationSeconds: s.duration ?? 0,
        startIndex: Math.min(index, coords.length - 1),
      });
      index += Math.max(0, (s.geometry?.coordinates?.length ?? 1) - 1);
    }
  }
  if (!steps.length || steps[steps.length - 1]!.type !== 'ARRIVE') {
    steps.push({ type: 'ARRIVE', instruction: '', streetName: null, exitNumber: null, distanceMeters: 0, durationSeconds: 0, startIndex: coords.length - 1 });
  }
  return {
    provider: 'mapbox',
    attribution: '© Mapbox © OpenStreetMap',
    distanceMeters: r.distance ?? 0,
    durationSeconds: r.duration ?? 0,
    coordinates: coords.map(([lng, lat]) => [lat, lng] as [number, number]),
    steps,
  };
}

export class MapboxRouting implements RoutingProvider {
  readonly name = 'mapbox';

  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = 'https://api.mapbox.com',
  ) {}

  async route(from: LatLng, to: LatLng, signal?: AbortSignal): Promise<Route> {
    const url = new URL(
      `${this.baseUrl.replace(/\/$/, '')}/directions/v5/mapbox/driving-traffic/${from.lng},${from.lat};${to.lng},${to.lat}`,
    );
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('overview', 'full');
    url.searchParams.set('steps', 'true');
    url.searchParams.set('language', 'de');
    url.searchParams.set('access_token', this.accessToken);
    const res = await this.fetchImpl(url, { signal: signal ?? AbortSignal.timeout(10_000) });
    const text = await res.text();
    let body: MapboxResponse = {};
    try {
      body = JSON.parse(text) as MapboxResponse;
    } catch {
      /* unten behandelt */
    }
    if (body.code === 'NoRoute' || body.code === 'NoSegment') throw new RoutingError('NOT_FOUND', 'Keine Route zu diesem Ziel gefunden');
    if (!res.ok) throw httpError(res.status, body.message ?? '');
    return parseMapboxResponse(body);
  }
}
