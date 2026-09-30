import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { ERROR_CODES, type UserRole } from '@parking/shared';
import { InvalidTokenError, type IdentityProvider } from '../adapters/identity';
import { AppError } from '../lib/errors';
import type { CurrentUser, UserService } from '../services/user-service';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: CurrentUser | null;
  }
  interface FastifyInstance {
    /** preHandler: verlangt einen gültigen, aktiven Nutzer. */
    authenticate: preHandlerHookHandler;
    /** preHandler: setzt currentUser, falls ein gültiges Token mitkommt; sonst anonym weiter. */
    optionalAuth: preHandlerHookHandler;
    /** preHandler: verlangt mindestens eine der Rollen (impliziert authenticate). */
    requireRoles: (...roles: UserRole[]) => preHandlerHookHandler;
  }
}

/** Liefert den eingeloggten Nutzer oder wirft 401. Für Handler hinter `authenticate`. */
export function requireUser(request: FastifyRequest): CurrentUser {
  if (!request.currentUser) throw AppError.unauthenticated();
  return request.currentUser;
}

interface AuthPluginOptions {
  identity: IdentityProvider;
  users: UserService;
}

export const authPlugin = fp<AuthPluginOptions>(async (app: FastifyInstance, { identity, users }) => {
  app.decorateRequest('currentUser', null);

  const authenticate: preHandlerHookHandler = async (request) => {
    if (request.currentUser) return;
    const header = request.headers.authorization;
    const match = header?.match(/^Bearer\s+(\S+)$/i);
    if (!match?.[1]) throw AppError.unauthenticated();

    let authIdentity;
    try {
      authIdentity = await identity.verifyAccessToken(match[1]);
    } catch (err) {
      if (err instanceof InvalidTokenError) throw AppError.unauthenticated('Sitzung abgelaufen, bitte erneut anmelden');
      throw err;
    }

    const user = await users.resolveCurrentUser(authIdentity);
    if (user.status === 'SUSPENDED') {
      throw new AppError(403, ERROR_CODES.ACCOUNT_SUSPENDED, 'Dein Konto ist gesperrt. Bitte kontaktiere den Support.');
    }
    if (user.status === 'DELETED') throw AppError.unauthenticated();
    request.currentUser = user;
  };

  app.decorate('authenticate', authenticate);
  app.decorate('optionalAuth', async function (request, reply) {
    if (!request.headers.authorization) return;
    try {
      await authenticate.call(this, request, reply, () => undefined);
    } catch (err) {
      // Öffentliche Endpunkte: ungültige/abgelaufene Tokens führen nicht zu einem Fehler
      if (!(err instanceof AppError) || err.statusCode !== 401) throw err;
    }
  } as preHandlerHookHandler);
  app.decorate('requireRoles', (...roles: UserRole[]): preHandlerHookHandler => {
    return async function (request, reply) {
      await authenticate.call(this, request, reply, () => undefined);
      const user = requireUser(request);
      if (!roles.some((r) => user.roles.includes(r))) throw AppError.forbidden();
    };
  });
});
