import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  bookingListSchema,
  bookingSchema,
  cancelBookingSchema,
  cancelPreviewSchema,
  createBookingResponseSchema,
  createBookingSchema,
  createEventSchema,
  eventListSchema,
  eventSchema,
  extendBookingSchema,
  extendResponseSchema,
  loyaltySchema,
  onboardingLinkSchema,
  paymentConfigSchema,
  payoutAccountSchema,
  quoteRequestSchema,
  quoteSchema,
  twintPayRequestSchema,
  twintPayResponseSchema,
} from '@parking/shared';
import { requireUser } from '../plugins/auth';
import { verifyStripeSignature } from '../adapters/payments';
import type { BookingService } from '../services/booking-service';
import type { LoyaltyService } from '../services/loyalty-service';

const idParams = z.object({ id: z.uuid() });

interface Opts {
  bookings: BookingService;
  loyalty: LoyaltyService;
  webhookSecret: string | null;
}

/** Kleine HTML-Seite nach dem Stripe-Onboarding: zurück in die App. */
function backToApp(title: string, text: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta http-equiv="refresh" content="1;url=parkly://host/payouts">
<style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f6f7fb;color:#01184a}
main{text-align:center;padding:24px}a{display:inline-block;margin-top:16px;background:#0b5cff;color:#fff;padding:14px 22px;border-radius:14px;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(text)}</p><a href="parkly://host/payouts">Zurück zu Parkly</a></main></body></html>`;
}

export const bookingRoutes: FastifyPluginAsyncZod<Opts> = async (app, { bookings, loyalty, webhookSecret }) => {
  app.addHook('onSend', async (_req, reply) => {
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'private, no-store');
  });

  /* ─────────────── Öffentlich ─────────────── */

  app.get('/payments/config', { schema: { tags: ['payments'], response: { 200: paymentConfigSchema } } }, async () => ({
    provider: bookings.provider.name,
    publishableKey: bookings.provider.publishableKey,
    merchantCountry: 'CH',
    merchantName: 'Parkly',
  }));

  app.post(
    '/spots/:id/quote',
    { preHandler: app.optionalAuth, config: { rateLimit: { max: 120, timeWindow: '1 minute' } }, schema: { tags: ['bookings'], params: idParams, body: quoteRequestSchema, response: { 200: quoteSchema } } },
    async (request) => bookings.quote(request.currentUser?.id ?? null, request.params.id, request.body.startAt, request.body.endAt),
  );

  app.get('/events', { preHandler: app.optionalAuth, schema: { tags: ['events'], response: { 200: eventListSchema } } }, async (request) => ({
    items: await loyalty.upcoming(request.currentUser?.id ?? null),
  }));

  app.get('/stripe/connect/return', { schema: { hide: true } }, async (_req, reply) =>
    reply.type('text/html').header('Cache-Control', 'no-store').send(backToApp('Fertig', 'Deine Angaben sind bei Stripe. Du kannst zurück in die App.')),
  );
  app.get('/stripe/connect/refresh', { schema: { hide: true } }, async (_req, reply) =>
    reply.type('text/html').header('Cache-Control', 'no-store').send(backToApp('Link abgelaufen', 'Bitte öffne "Auszahlungen einrichten" in der App nochmals.')),
  );

  /* ─────────────── Mieter ─────────────── */
  await app.register(async (plain) => {
    const r = plain.withTypeProvider<ZodTypeProvider>();
    r.addHook('preHandler', app.authenticate);

    r.post(
      '/bookings',
      { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } }, schema: { tags: ['bookings'], body: createBookingSchema, response: { 201: createBookingResponseSchema } } },
      async (request, reply) => reply.status(201).send(await bookings.create(requireUser(request).id, request.body)),
    );
    r.get('/bookings', { schema: { tags: ['bookings'], response: { 200: bookingListSchema } } }, async (request) => ({ items: await bookings.list(requireUser(request).id) }));
    r.get('/bookings/:id', { schema: { tags: ['bookings'], params: idParams, response: { 200: bookingSchema } } }, async (request) =>
      bookings.get(requireUser(request).id, request.params.id),
    );
    r.post('/bookings/:id/sync', { schema: { tags: ['bookings'], params: idParams, response: { 200: bookingSchema } } }, async (request) =>
      bookings.sync(requireUser(request).id, request.params.id),
    );
    r.post(
      '/bookings/:id/twint',
      { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } }, schema: { tags: ['bookings'], params: idParams, body: twintPayRequestSchema, response: { 200: twintPayResponseSchema } } },
      async (request) => bookings.payTwint(requireUser(request).id, request.params.id, request.body.returnUrl),
    );
    r.post('/bookings/:id/dev-pay', { schema: { tags: ['bookings'], params: idParams, response: { 200: bookingSchema } } }, async (request) =>
      bookings.devPay(requireUser(request).id, request.params.id),
    );
    r.get('/bookings/:id/cancel-preview', { schema: { tags: ['bookings'], params: idParams, response: { 200: cancelPreviewSchema } } }, async (request) =>
      bookings.preview(requireUser(request).id, request.params.id),
    );
    r.post('/bookings/:id/cancel', { schema: { tags: ['bookings'], params: idParams, body: cancelBookingSchema, response: { 200: bookingSchema } } }, async (request) =>
      bookings.cancel(requireUser(request).id, request.params.id, request.body.reason ?? null),
    );
    r.post(
      '/bookings/:id/extend',
      { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } }, schema: { tags: ['bookings'], params: idParams, body: extendBookingSchema, response: { 200: extendResponseSchema } } },
      async (request) => bookings.extend(requireUser(request).id, request.params.id, request.body.minutes),
    );
    r.get('/me/loyalty', { schema: { tags: ['loyalty'], response: { 200: loyaltySchema } } }, async (request) => loyalty.summary(requireUser(request).id));
  });

  /* ─────────────── Vermieter ─────────────── */
  await app.register(async (plain) => {
    const h = plain.withTypeProvider<ZodTypeProvider>();
    h.addHook('preHandler', app.requireRoles('HOST'));

    h.get('/host/bookings', { schema: { tags: ['host'], response: { 200: bookingListSchema } } }, async (request) => ({ items: await bookings.hostList(requireUser(request).id) }));
    h.post('/host/bookings/:id/accept', { schema: { tags: ['host'], params: idParams, response: { 200: bookingSchema } } }, async (request) =>
      bookings.accept(requireUser(request).id, request.params.id),
    );
    h.post('/host/bookings/:id/decline', { schema: { tags: ['host'], params: idParams, body: cancelBookingSchema, response: { 200: bookingSchema } } }, async (request) =>
      bookings.decline(requireUser(request).id, request.params.id, request.body.reason ?? null),
    );
    h.post('/host/bookings/:id/cancel', { schema: { tags: ['host'], params: idParams, body: cancelBookingSchema, response: { 200: bookingSchema } } }, async (request) =>
      bookings.hostCancel(requireUser(request).id, request.params.id, request.body.reason ?? null),
    );
    h.get('/host/payouts', { schema: { tags: ['host'], response: { 200: payoutAccountSchema } } }, async (request) => bookings.payoutAccount(requireUser(request).id));
    h.post('/host/payouts/onboarding', { schema: { tags: ['host'], response: { 200: onboardingLinkSchema } } }, async (request) => ({
      url: await bookings.onboardingLink(requireUser(request).id),
    }));
  });

  /* ─────────────── Admin ─────────────── */
  app.post(
    '/admin/events',
    { preHandler: app.requireRoles('ADMIN'), schema: { tags: ['admin'], body: createEventSchema, response: { 201: eventSchema } } },
    async (request, reply) => reply.status(201).send(await loyalty.createEvent(request.body)),
  );

  /* ─────────────── Stripe Webhook ─────────────── */
  await app.register(async (hook) => {
    // Signatur wird über den Original-Body geprüft
    hook.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 512 * 1024 }, (_req, body, done) => done(null, body));
    hook.post('/webhooks/stripe', { config: { rateLimit: false }, schema: { hide: true } }, async (request, reply) => {
      if (!webhookSecret) return reply.status(404).send();
      const raw = typeof request.body === 'string' ? request.body : '';
      const header = request.headers['stripe-signature'];
      if (!verifyStripeSignature(raw, typeof header === 'string' ? header : undefined, webhookSecret)) return reply.status(400).send({ error: 'invalid signature' });
      const event = JSON.parse(raw) as { id: string; type: string; data: { object: Record<string, unknown> } };
      await bookings.handleWebhook(event);
      return reply.status(200).send({ received: true });
    });
  });
};
