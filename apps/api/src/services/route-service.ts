import type { FastifyBaseLogger } from 'fastify';
import { distanceMeters, ERROR_CODES, type LatLng, type Route } from '@parking/shared';
import { AppError } from '../lib/errors';
import { RoutingError, type RoutingProvider } from '../adapters/routing';

/** Längste erlaubte Luftlinie; schützt das Kontingent vor Unsinnsanfragen. */
const MAX_AIR_DISTANCE_M = 800_000;

export class RouteService {
  constructor(
    private readonly provider: RoutingProvider | null,
    private readonly log: FastifyBaseLogger,
  ) {}

  async route(from: LatLng, to: LatLng): Promise<Route> {
    if (!this.provider) {
      throw new AppError(
        503,
        ERROR_CODES.SERVICE_UNAVAILABLE,
        'Die Route in der App ist noch nicht eingerichtet. Öffne die Route in Apple oder Google Maps.',
        { reason: 'ROUTING_NOT_CONFIGURED' },
      );
    }
    const air = distanceMeters(from, to);
    if (air < 25) throw new AppError(422, ERROR_CODES.ROUTE_NOT_FOUND, 'Du bist bereits am Ziel');
    if (air > MAX_AIR_DISTANCE_M) throw new AppError(422, ERROR_CODES.ROUTE_NOT_FOUND, 'Das Ziel ist zu weit entfernt');

    try {
      return await this.provider.route(from, to);
    } catch (err) {
      if (err instanceof RoutingError) {
        if (err.kind === 'NOT_FOUND') throw new AppError(422, ERROR_CODES.ROUTE_NOT_FOUND, 'Keine Autoroute zu diesem Ziel gefunden');
        // Koordinaten bewusst nicht loggen (Datenschutz)
        this.log.error({ provider: this.provider.name, kind: err.kind, msg: err.message }, 'Routing fehlgeschlagen');
        throw new AppError(
          503,
          ERROR_CODES.SERVICE_UNAVAILABLE,
          err.kind === 'RATE_LIMITED'
            ? 'Der Routen-Dienst ist gerade ausgelastet. Versuche es gleich nochmals.'
            : 'Der Routen-Dienst ist gerade nicht erreichbar.',
          { reason: err.kind === 'UNAUTHORIZED' ? 'ROUTING_KEY_INVALID' : err.kind },
        );
      }
      this.log.error({ provider: this.provider.name, err: err instanceof Error ? err.message : String(err) }, 'Routing fehlgeschlagen');
      throw new AppError(503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Der Routen-Dienst ist gerade nicht erreichbar.');
    }
  }
}
