import type { FastifyPluginAsync } from 'fastify';
import { IMAGE_MAX_BYTES } from '@parking/shared';
import type { DevStorage } from '../adapters/storage';

/** Nur Entwicklung/Tests: ersetzt Supabase Storage durch lokale Dateien (in production gesperrt). */
export const devStorageRoutes: FastifyPluginAsync<{ storage: DevStorage }> = async (app, { storage }) => {
  app.addContentTypeParser(/^image\//, { parseAs: 'buffer', bodyLimit: IMAGE_MAX_BYTES }, (_req, body, done) => done(null, body));

  app.put<{ Params: { '*': string }; Querystring: { exp: string; sig: string } }>(
    '/dev-storage/upload/*',
    { bodyLimit: IMAGE_MAX_BYTES },
    async (request, reply) => {
      const key = request.params['*'];
      if (!storage.verify('put', key, Number(request.query.exp), request.query.sig ?? '')) return reply.status(403).send({ error: 'Ungültige Signatur' });
      if (await storage.stat(key)) return reply.status(409).send({ error: 'Existiert bereits' });
      const body = request.body as Buffer;
      await storage.write(key, body, String(request.headers['content-type'] ?? 'application/octet-stream'));
      return reply.send({ Key: key });
    },
  );

  app.get<{ Params: { '*': string }; Querystring: { exp: string; sig: string } }>('/dev-storage/object/*', async (request, reply) => {
    const key = request.params['*'];
    if (!storage.verify('get', key, Number(request.query.exp), request.query.sig ?? '')) return reply.status(403).send({ error: 'Ungültige Signatur' });
    const file = await storage.read(key);
    if (!file) return reply.status(404).send({ error: 'Nicht gefunden' });
    return reply
      .header('Content-Type', file.contentType)
      .header('Cache-Control', 'private, max-age=3600')
      // Bilder werden von der App (anderer Origin im Browser) geladen
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .send(file.data);
  });
};
