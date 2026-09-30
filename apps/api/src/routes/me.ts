import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { becomeHostSchema, meSchema, pushTokenSchema, updateMeSchema } from '@parking/shared';
import { requireUser } from '../plugins/auth';
import type { UserService } from '../services/user-service';

export const meRoutes: FastifyPluginAsyncZod<{ users: UserService }> = async (app, { users }) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/me', { schema: { tags: ['me'], response: { 200: meSchema } } }, async (request) => {
    return users.getMe(requireUser(request).id);
  });

  app.patch(
    '/me',
    { schema: { tags: ['me'], body: updateMeSchema, response: { 200: meSchema } } },
    async (request) => users.updateMe(requireUser(request).id, request.body),
  );

  app.post(
    '/me/accept-terms',
    { schema: { tags: ['me'], response: { 200: meSchema } } },
    async (request) => users.acceptTerms(requireUser(request).id),
  );

  app.post(
    '/me/host',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: { tags: ['me'], body: becomeHostSchema, response: { 200: meSchema } },
    },
    async (request) => users.becomeHost(requireUser(request), request.body),
  );

  app.post(
    '/me/push-tokens',
    { schema: { tags: ['me'], body: pushTokenSchema, response: { 204: z.null() } } },
    async (request, reply) => {
      await users.registerPushToken(requireUser(request).id, request.body.token, request.body.platform);
      return reply.status(204).send(null);
    },
  );

  app.delete(
    '/me',
    {
      config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
      schema: { tags: ['me'], response: { 204: z.null() } },
    },
    async (request, reply) => {
      await users.deleteAccount(requireUser(request));
      return reply.status(204).send(null);
    },
  );
};
