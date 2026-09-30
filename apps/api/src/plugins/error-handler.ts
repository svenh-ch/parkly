import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { ERROR_CODES, type ApiErrorBody } from '@parking/shared';
import { AppError, PG_ERRORS, pgConstraint, pgErrorCode } from '../lib/errors';

/**
 * Einheitliches Fehlerformat: { error: { code, message, details?, requestId } }.
 * Interne Details (Stacktraces, SQL) gelangen nie an den Client.
 */
export const errorHandlerPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const send = (status: number, body: ApiErrorBody['error']) =>
      reply.status(status).send({ error: { ...body, requestId: request.id } } satisfies ApiErrorBody);

    if (err instanceof AppError) {
      return send(err.statusCode, { code: err.code, message: err.message, details: err.details });
    }

    if (hasZodFastifySchemaValidationErrors(err)) {
      return send(400, {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Ungültige Eingabe',
        // body | querystring | params | headers
        details: { in: err.validationContext, issues: err.validation.map((v) => ({
          path: v.instancePath.replace(/^\//, '').replaceAll('/', '.'),
          message: v.message,
        })) },
      });
    }

    if (isResponseSerializationError(err)) {
      request.log.error({ err }, 'Antwort entspricht nicht dem Schema');
      return send(500, { code: ERROR_CODES.INTERNAL, message: 'Interner Fehler' });
    }

    if (err.statusCode === 429) {
      return send(429, { code: ERROR_CODES.RATE_LIMITED, message: 'Zu viele Anfragen, bitte kurz warten' });
    }

    const pgCode = pgErrorCode(err);
    if (pgCode === PG_ERRORS.EXCLUSION_VIOLATION) {
      return send(409, {
        code: ERROR_CODES.CONFLICT,
        message: 'Dieser Zeitraum ist nicht mehr verfügbar',
        details: { constraint: pgConstraint(err) },
      });
    }
    if (pgCode === PG_ERRORS.UNIQUE_VIOLATION) {
      return send(409, { code: ERROR_CODES.CONFLICT, message: 'Eintrag existiert bereits' });
    }

    // Fastify-eigene Client-Fehler (z. B. ungültiges JSON, zu grosser Body)
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return send(err.statusCode, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message });
    }

    request.log.error({ err }, 'Unbehandelter Fehler');
    return send(500, { code: ERROR_CODES.INTERNAL, message: 'Interner Fehler' });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Route nicht gefunden', requestId: request.id },
    }),
  );
});
