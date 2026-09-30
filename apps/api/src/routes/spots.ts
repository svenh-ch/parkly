import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createSpotSchema,
  hostFeeSchema,
  hostSpotListSchema,
  hostSpotSchema,
  imageUploadTicketSchema,
  reorderImagesSchema,
  requestImageUploadSchema,
  spotAvailabilityInputSchema,
  spotDetailSchema,
  spotImageSchema,
  updateSpotSchema,
} from '@parking/shared';
import { requireUser } from '../plugins/auth';
import type { SpotService } from '../services/spot-service';
import type { LoyaltyService } from '../services/loyalty-service';

const idParams = z.object({ id: z.uuid() });
const imageParams = z.object({ id: z.uuid(), imageId: z.uuid() });

export const spotRoutes: FastifyPluginAsyncZod<{ spots: SpotService; loyalty: LoyaltyService }> = async (app, { spots, loyalty }) => {
  /* ─────────────── Öffentlich ─────────────── */
  app.get(
    '/spots/:id',
    { preHandler: app.optionalAuth, schema: { tags: ['spots'], params: idParams, response: { 200: spotDetailSchema } } },
    async (request, reply) => {
      // Signierte Foto-URLs laufen ab: nicht öffentlich cachen
      reply.header('Cache-Control', 'private, no-store');
      return spots.detail(request.params.id, request.currentUser?.id ?? null);
    },
  );

  /* ─────────────── Vermieter ─────────────── */
  await app.register(async (plain) => {
    const host = plain.withTypeProvider<ZodTypeProvider>();
    host.addHook('preHandler', app.requireRoles('HOST'));
    host.addHook('onSend', async (_req, reply) => {
      reply.header('Cache-Control', 'private, no-store');
    });

    host.get('/host/fee', { schema: { tags: ['host'], response: { 200: hostFeeSchema } } }, async (request) => {
      // Gebühr je nach Treue-Stufe des Vermieters; Servicegebühr der Mieter ab Bronze
      const [mine, bronze] = await Promise.all([loyalty.current(requireUser(request).id), loyalty.info('BRONZE')]);
      return { hostFeeBps: mine.hostFeeBps, renterFeeBps: bronze.renterFeeBps };
    });

    host.get('/host/spots', { schema: { tags: ['host'], response: { 200: hostSpotListSchema } } }, async (request) => ({
      items: await spots.list(requireUser(request).id),
    }));

    host.post(
      '/host/spots',
      { config: { rateLimit: { max: 20, timeWindow: '1 hour' } }, schema: { tags: ['host'], body: createSpotSchema, response: { 201: hostSpotSchema } } },
      async (request, reply) => reply.status(201).send(await spots.create(requireUser(request).id, request.body)),
    );

    host.get('/host/spots/:id', { schema: { tags: ['host'], params: idParams, response: { 200: hostSpotSchema } } }, async (request) =>
      spots.get(requireUser(request).id, request.params.id),
    );

    host.patch(
      '/host/spots/:id',
      { schema: { tags: ['host'], params: idParams, body: updateSpotSchema, response: { 200: hostSpotSchema } } },
      async (request) => spots.update(requireUser(request).id, request.params.id, request.body),
    );

    host.put(
      '/host/spots/:id/availability',
      { schema: { tags: ['host'], params: idParams, body: spotAvailabilityInputSchema, response: { 200: hostSpotSchema } } },
      async (request) => spots.setAvailability(requireUser(request).id, request.params.id, request.body),
    );

    host.post('/host/spots/:id/publish', { schema: { tags: ['host'], params: idParams, response: { 200: hostSpotSchema } } }, async (request) =>
      spots.publish(requireUser(request).id, request.params.id),
    );
    host.post('/host/spots/:id/pause', { schema: { tags: ['host'], params: idParams, response: { 200: hostSpotSchema } } }, async (request) =>
      spots.pause(requireUser(request).id, request.params.id),
    );

    host.delete('/host/spots/:id', { schema: { tags: ['host'], params: idParams, response: { 204: z.null() } } }, async (request, reply) => {
      await spots.remove(requireUser(request).id, request.params.id);
      return reply.status(204).send(null);
    });

    host.post(
      '/host/spots/:id/images',
      {
        config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
        schema: { tags: ['host'], params: idParams, body: requestImageUploadSchema, response: { 201: imageUploadTicketSchema } },
      },
      async (request, reply) => reply.status(201).send(await spots.requestImageUpload(requireUser(request).id, request.params.id, request.body)),
    );
    host.post(
      '/host/spots/:id/images/:imageId/complete',
      { schema: { tags: ['host'], params: imageParams, response: { 200: spotImageSchema } } },
      async (request) => spots.completeImageUpload(requireUser(request).id, request.params.id, request.params.imageId),
    );
    host.put(
      '/host/spots/:id/images/order',
      { schema: { tags: ['host'], params: idParams, body: reorderImagesSchema, response: { 200: hostSpotSchema } } },
      async (request) => spots.reorderImages(requireUser(request).id, request.params.id, request.body),
    );
    host.delete(
      '/host/spots/:id/images/:imageId',
      { schema: { tags: ['host'], params: imageParams, response: { 200: hostSpotSchema } } },
      async (request) => spots.deleteImage(requireUser(request).id, request.params.id, request.params.imageId),
    );
  });
};
