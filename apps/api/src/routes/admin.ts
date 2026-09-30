import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { facilityTariffsInputSchema } from '@parking/shared';
import { requireUser } from '../plugins/auth';
import type { FacilityService } from '../services/facility-service';

/** Pflege-Endpunkte für Admins (Tarife mit "Stand vom"). */
export const adminRoutes: FastifyPluginAsyncZod<{ facilities: FacilityService }> = async (app, { facilities }) => {
  app.put(
    '/admin/facilities/:id/tariffs',
    {
      preHandler: app.requireRoles('ADMIN'),
      schema: { tags: ['admin'], params: z.object({ id: z.uuid() }), body: facilityTariffsInputSchema, response: { 204: z.null() } },
    },
    async (request, reply) => {
      await facilities.setTariffs(request.params.id, request.body, requireUser(request).id);
      return reply.status(204).send(null);
    },
  );
};
