import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { placeSearchQuerySchema, placeSearchResponseSchema } from '@parking/shared';
import type { SearchService } from '../services/search-service';

export const searchRoutes: FastifyPluginAsyncZod<{ search: SearchService }> = async (app, { search }) => {
  app.get(
    '/search/places',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { tags: ['search'], querystring: placeSearchQuerySchema, response: { 200: placeSearchResponseSchema } },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'public, max-age=300');
      const { q, lat, lng } = request.query;
      // Mit Position nicht öffentlich cachen (Reihenfolge ist standortabhängig)
      if (lat !== undefined && lng !== undefined) reply.header('Cache-Control', 'private, max-age=300');
      return { items: await search.search(q, lat !== undefined && lng !== undefined ? { lat, lng } : undefined) };
    },
  );
};
