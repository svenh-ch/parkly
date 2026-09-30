import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../db/client';

export const healthRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get(
    '/health',
    { config: { rateLimit: false }, schema: { hide: true, response: { 200: z.object({ status: z.literal('ok') }) } } },
    async () => ({ status: 'ok' as const }),
  );

  app.get(
    '/health/ready',
    {
      config: { rateLimit: false },
      schema: {
        hide: true,
        response: { 200: z.object({ status: z.literal('ok'), db: z.literal('ok') }) },
      },
    },
    async () => {
      await db.execute(sql`select 1`);
      return { status: 'ok' as const, db: 'ok' as const };
    },
  );
};
