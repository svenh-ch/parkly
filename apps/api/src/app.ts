import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config';
import type { Database } from './db/client';
import type { IdentityProvider } from './adapters/identity';
import { errorHandlerPlugin } from './plugins/error-handler';
import { authPlugin } from './plugins/auth';
import { healthRoutes } from './routes/health';
import { mapRoutes } from './routes/map';
import { meRoutes } from './routes/me';
import { socialRoutes } from './routes/social';
import { searchRoutes } from './routes/search';
import { routeRoutes } from './routes/route';
import { spotRoutes } from './routes/spots';
import { adminRoutes } from './routes/admin';
import { devStorageRoutes } from './routes/dev-storage';
import { DevStorage, SupabaseStorage, type StorageProvider } from './adapters/storage';
import { SpotService } from './services/spot-service';
import { MapboxRouting, OpenRouteServiceRouting, type RoutingProvider } from './adapters/routing';
import { RouteService } from './services/route-service';
import { OrsPoiSearch, OrsWalking, type PoiSearchProvider, type WalkingProvider } from './adapters/places';
import { startPlsSync } from './jobs/pls-sync';
import { startLiveSync, type LiveSource } from './jobs/live-sync';
import { fetchLuzernPls, fetchZugPls } from './adapters/parking-data/central-switzerland';
import { SwisstopoGeocoder, type GeocodingProvider } from './adapters/geocoding';
import { FacilityService } from './services/facility-service';
import { MapService } from './services/map-service';
import { SocialService } from './services/social-service';
import { SearchService } from './services/search-service';
import { UserService } from './services/user-service';
import { DevPayments, StripePayments, type PaymentProvider } from './adapters/payments';
import { LoyaltyService } from './services/loyalty-service';
import { BookingService } from './services/booking-service';
import { bookingRoutes } from './routes/bookings';
import { startBookingJobs } from './jobs/booking-jobs';

export interface AppDeps {
  config: Config;
  db: Database;
  identity: IdentityProvider;
  /** Optional überschreibbar (Tests); sonst gemäss GEOCODING_PROVIDER. */
  geocoder?: GeocodingProvider | null;
  /** Optional überschreibbar (Tests); sonst gemäss ROUTING_PROVIDER. */
  routing?: RoutingProvider | null;
  walking?: WalkingProvider | null;
  pois?: PoiSearchProvider | null;
  storage?: StorageProvider | null;
  payments?: PaymentProvider;
}

function routingFromConfig(config: Config): RoutingProvider | null {
  if (config.ROUTING_PROVIDER === 'openrouteservice' && config.ORS_API_KEY) {
    return new OpenRouteServiceRouting(config.ORS_API_KEY, fetch, config.ORS_BASE_URL);
  }
  if (config.ROUTING_PROVIDER === 'mapbox' && config.MAPBOX_ACCESS_TOKEN) {
    return new MapboxRouting(config.MAPBOX_ACCESS_TOKEN);
  }
  return null;
}

/**
 * Baut die Fastify-Instanz. Alle externen Abhängigkeiten werden injiziert,
 * damit Tests und spätere Deployments (Worker, Serverless) sie austauschen können.
 */
export async function buildApp({ config, db, identity, geocoder: geocoderOverride, routing: routingOverride, walking: walkingOverride, pois: poisOverride, storage: storageOverride, payments: paymentsOverride }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.apikey'],
      ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 256 * 1024, // Bilder gehen direkt in den Storage, nie durch die API
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(errorHandlerPlugin);
  await app.register(helmet, { contentSecurityPolicy: false }); // reine JSON-API
  await app.register(cors, {
    origin: config.CORS_ORIGINS ? config.CORS_ORIGINS.split(',').map((o) => o.trim()) : false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
  });

  if (config.ENABLE_API_DOCS) {
    const swagger = await import('@fastify/swagger');
    await app.register(swagger.default, {
      openapi: { info: { title: 'Parking API', version: '1.0.0' } },
      transform: jsonSchemaTransform,
    });
    app.get('/docs/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  }

  const storagePublicUrl = `${config.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public`;
  const users = new UserService(db, identity, (path) => `${storagePublicUrl}/avatars/${path}`);
  const orsKey = config.ORS_API_KEY || null;
  const walking = walkingOverride !== undefined ? walkingOverride : orsKey ? new OrsWalking(orsKey, fetch, config.ORS_BASE_URL) : null;
  const pois = poisOverride !== undefined ? poisOverride : orsKey ? new OrsPoiSearch(orsKey, fetch, config.ORS_BASE_URL) : null;
  const map = new MapService(db, undefined, walking, app.log);
  const facilities = new FacilityService(db);
  const social = new SocialService(db, map);
  const geocoder =
    geocoderOverride !== undefined
      ? geocoderOverride
      : config.GEOCODING_PROVIDER === 'swisstopo'
        ? new SwisstopoGeocoder(fetch, config.SWISSTOPO_SEARCH_URL)
        : null;
  const search = new SearchService(db, geocoder, app.log, pois);
  const routing = routingOverride !== undefined ? routingOverride : routingFromConfig(config);
  if (!routing && config.NODE_ENV !== 'test' && config.ROUTING_PROVIDER !== 'none') {
    app.log.warn(
      `In-App-Route aus: ${config.ROUTING_PROVIDER === 'mapbox' ? 'MAPBOX_ACCESS_TOKEN' : 'ORS_API_KEY'} fehlt in apps/api/.env`,
    );
  }
  const routes = new RouteService(routing, app.log);

  // Foto-Speicher: Supabase (Standard) oder lokale Dateien in der Entwicklung
  const devStorage =
    storageOverride === undefined && config.STORAGE_PROVIDER === 'dev'
      ? new DevStorage(
          config.DEV_STORAGE_DIR,
          config.PUBLIC_API_URL ?? `http://localhost:${config.PORT}`,
          config.SUPABASE_JWT_SECRET ?? 'dev-storage-secret-only-for-local-development',
        )
      : null;
  const storage: StorageProvider | null =
    storageOverride !== undefined
      ? storageOverride
      : devStorage ?? (config.SUPABASE_SERVICE_ROLE_KEY ? new SupabaseStorage(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, config.STORAGE_BUCKET) : null);
  if (!storage && config.NODE_ENV !== 'test') app.log.warn('Foto-Upload aus: SUPABASE_SERVICE_ROLE_KEY fehlt in apps/api/.env');
  const spots = new SpotService(db, storage);

  // Zahlungen: Stripe oder Testzahlung (dev, in production gesperrt)
  const paymentProvider: PaymentProvider =
    paymentsOverride ??
    (config.PAYMENT_PROVIDER === 'stripe' ? new StripePayments(config.STRIPE_SECRET_KEY!, config.STRIPE_PUBLISHABLE_KEY!) : new DevPayments());
  if (paymentProvider.name === 'dev' && config.NODE_ENV === 'development') app.log.warn('Zahlungen: Testmodus (PAYMENT_PROVIDER=dev), es fliesst kein echtes Geld');
  const loyalty = new LoyaltyService(db);
  const bookingService = new BookingService(
    db,
    paymentProvider,
    loyalty,
    spots,
    {
      publicApiUrl: config.PUBLIC_API_URL ?? `http://localhost:${config.PORT}`,
      payoutDelayHours: config.PAYOUT_DELAY_HOURS,
      allowDevPay: config.NODE_ENV !== 'production',
    },
    app.log,
  );

  await app.register(authPlugin, { identity, users });
  await app.register(healthRoutes, { db });
  await app.register(
    async (v1) => {
      await v1.register(meRoutes, { users });
      await v1.register(mapRoutes, { map });
      await v1.register(socialRoutes, { social });
      await v1.register(searchRoutes, { search });
      await v1.register(routeRoutes, { routes });
      await v1.register(spotRoutes, { spots, loyalty });
      await v1.register(adminRoutes, { facilities });
      await v1.register(bookingRoutes, { bookings: bookingService, loyalty, webhookSecret: config.STRIPE_WEBHOOK_SECRET || null });
    },
    { prefix: '/v1' },
  );

  if (storage instanceof DevStorage) await app.register(devStorageRoutes, { storage });

  if (config.PLS_SYNC_ENABLED && config.NODE_ENV !== 'test') {
    const stop = startPlsSync({
      facilities,
      geocoder,
      log: app.log,
      intervalMs: config.PLS_SYNC_INTERVAL_SECONDS * 1000,
    });
    app.addHook('onClose', async () => stop());
  }

  if (config.BOOKING_JOBS_ENABLED && config.NODE_ENV !== 'test') {
    const stop = startBookingJobs({ bookings: bookingService, log: app.log });
    app.addHook('onClose', async () => stop());
  }

  const liveSources: LiveSource[] = [
    ...(config.LIVE_LUZERN_ENABLED ? [{ region: 'luzern', fetch: () => fetchLuzernPls() }] : []),
    ...(config.LIVE_ZUG_ENABLED ? [{ region: 'zug', fetch: () => fetchZugPls() }] : []),
  ];
  if (liveSources.length && config.NODE_ENV !== 'test') {
    const stop = startLiveSync({ sources: liveSources, facilities, log: app.log, intervalMs: config.PLS_SYNC_INTERVAL_SECONDS * 1000 });
    app.addHook('onClose', async () => stop());
  }

  return app;
}
