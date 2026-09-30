import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  favoriteParamsSchema,
  favoritesQuerySchema,
  favoritesResponseSchema,
  moderateReviewSchema,
  myReviewsResponseSchema,
  reportReviewSchema,
  reviewListQuerySchema,
  reviewListSchema,
  reviewSchema,
  upsertReviewSchema,
} from '@parking/shared';
import { requireUser } from '../plugins/auth';
import type { SocialService } from '../services/social-service';

const idParams = z.object({ id: z.uuid() });

export const socialRoutes: FastifyPluginAsyncZod<{ social: SocialService }> = async (app, { social }) => {
  /* ─────────────── Favoriten (nur eigene) ─────────────── */

  app.get(
    '/favorites',
    {
      preHandler: app.authenticate,
      schema: { tags: ['favorites'], querystring: favoritesQuerySchema, response: { 200: favoritesResponseSchema } },
    },
    async (request) => {
      const { lat, lng } = request.query;
      const from = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
      return { items: await social.listFavorites(requireUser(request).id, from) };
    },
  );

  app.put(
    '/favorites/:kind/:id',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { tags: ['favorites'], params: favoriteParamsSchema, response: { 204: z.null() } },
    },
    async (request, reply) => {
      await social.addFavorite(requireUser(request).id, request.params);
      return reply.status(204).send(null);
    },
  );

  app.delete(
    '/favorites/:kind/:id',
    {
      preHandler: app.authenticate,
      schema: { tags: ['favorites'], params: favoriteParamsSchema, response: { 204: z.null() } },
    },
    async (request, reply) => {
      await social.removeFavorite(requireUser(request).id, request.params);
      return reply.status(204).send(null);
    },
  );

  /* ─────────────── Bewertungen ─────────────── */

  app.get(
    '/facilities/:id/reviews',
    {
      preHandler: app.optionalAuth,
      schema: { tags: ['reviews'], params: idParams, querystring: reviewListQuerySchema, response: { 200: reviewListSchema } },
    },
    async (request) =>
      social.listReviews({ kind: 'PUBLIC_PARKING', id: request.params.id }, request.currentUser?.id ?? null, request.query),
  );

  app.get(
    '/spots/:id/reviews',
    {
      preHandler: app.optionalAuth,
      schema: { tags: ['reviews'], params: idParams, querystring: reviewListQuerySchema, response: { 200: reviewListSchema } },
    },
    async (request) =>
      social.listReviews(
        { kind: 'PRIVATE_MARKETPLACE_PARKING', id: request.params.id },
        request.currentUser?.id ?? null,
        request.query,
      ),
  );

  app.put(
    '/facilities/:id/reviews/mine',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: { tags: ['reviews'], params: idParams, body: upsertReviewSchema, response: { 200: reviewSchema } },
    },
    async (request) => social.upsertFacilityReview(requireUser(request).id, request.params.id, request.body),
  );

  app.delete(
    '/facilities/:id/reviews/mine',
    { preHandler: app.authenticate, schema: { tags: ['reviews'], params: idParams, response: { 204: z.null() } } },
    async (request, reply) => {
      await social.deleteFacilityReview(requireUser(request).id, request.params.id);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/me/reviews',
    { preHandler: app.authenticate, schema: { tags: ['reviews'], response: { 200: myReviewsResponseSchema } } },
    async (request) => ({ items: await social.myReviews(requireUser(request).id) }),
  );

  app.post(
    '/reviews/:id/report',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: { tags: ['reviews'], params: idParams, body: reportReviewSchema, response: { 204: z.null() } },
    },
    async (request, reply) => {
      await social.reportReview(requireUser(request).id, request.params.id, request.body);
      return reply.status(204).send(null);
    },
  );

  /* ─────────────── Admin ─────────────── */

  app.patch(
    '/admin/reviews/:id',
    {
      preHandler: app.requireRoles('ADMIN'),
      schema: { tags: ['admin'], params: idParams, body: moderateReviewSchema, response: { 204: z.null() } },
    },
    async (request, reply) => {
      await social.moderateReview(requireUser(request).id, request.params.id, request.body.status);
      return reply.status(204).send(null);
    },
  );
};
