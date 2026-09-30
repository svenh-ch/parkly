import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  facilityDetailSchema,
  mapQuerySchema,
  mapResponseSchema,
  nearbyQuerySchema,
  nearbyResponseSchema,
} from '@parking/shared';
import type { MapService } from '../services/map-service';

/**
 * Öffentliche Kartendaten. Ohne Login lesbar (wie bei Airbnb kann man stöbern, bevor man ein
 * Konto hat). Mit Login zusätzlich personalisiert (Favoriten). Keine personenbezogenen Daten,
 * private Parkplätze nur mit ungefährer Position.
 */
export const mapRoutes: FastifyPluginAsyncZod<{ map: MapService }> = async (app, { map }) => {
  app.addHook('preHandler', app.optionalAuth);
  app.addHook('onSend', async (request, reply) => {
    // Personalisierte Antworten dürfen nicht in geteilten Caches landen
    reply.header('Cache-Control', request.currentUser ? 'private, no-store' : 'public, max-age=30');
  });

  app.get(
    '/map',
    {
      config: { rateLimit: { max: 240, timeWindow: '1 minute' } },
      schema: { tags: ['map'], querystring: mapQuerySchema, response: { 200: mapResponseSchema } },
    },
    async (request) => map.map(request.query, request.currentUser?.id ?? null),
  );

  app.get(
    '/nearby',
    { schema: { tags: ['map'], querystring: nearbyQuerySchema, response: { 200: nearbyResponseSchema } } },
    async (request) => ({ items: await map.nearby(request.query, request.currentUser?.id ?? null) }),
  );

  app.get(
    '/facilities/:id',
    {
      schema: {
        tags: ['map'],
        params: z.object({ id: z.uuid() }),
        response: { 200: facilityDetailSchema },
      },
    },
    async (request) => map.facility(request.params.id, request.currentUser?.id ?? null),
  );
};
