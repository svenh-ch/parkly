import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { routeRequestSchema, routeSchema } from '@parking/shared';
import type { RouteService } from '../services/route-service';

export const routeRoutes: FastifyPluginAsyncZod<{ routes: RouteService }> = async (app, { routes }) => {
  // POST, damit Standortdaten nie in URLs/Access-Logs landen
  app.post(
    '/route',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['route'], body: routeRequestSchema, response: { 200: routeSchema } },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return routes.route(request.body.from, request.body.to);
    },
  );
};
