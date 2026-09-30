import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';

/**
 * Identitäts-Port. Die API kennt nur dieses Interface; Supabase Auth ist austauschbar
 * (z. B. gegen Auth0, Cognito oder einen eigenen Auth-Service).
 */
export interface AuthIdentity {
  authUserId: string;
  email: string;
}

export interface IdentityProvider {
  /** Prüft ein Access Token und liefert die Identität, sonst Error. */
  verifyAccessToken(token: string): Promise<AuthIdentity>;
  /** Löscht den Login beim Provider (Konto-Löschung nach DSG). */
  deleteIdentity(authUserId: string): Promise<void>;
}

export class InvalidTokenError extends Error {
  constructor(message = 'Ungültiges oder abgelaufenes Token') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

interface SupabaseIdentityOptions {
  supabaseUrl: string;
  audience: string;
  /** Legacy HS256-Secret (optional). */
  jwtSecret?: string;
  /** Service-Role-Key für Admin-Operationen (optional, nur serverseitig!). */
  serviceRoleKey?: string;
}

export class SupabaseIdentityProvider implements IdentityProvider {
  private readonly issuer: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly secret?: Uint8Array;

  constructor(private readonly opts: SupabaseIdentityOptions) {
    const base = opts.supabaseUrl.replace(/\/$/, '');
    this.issuer = `${base}/auth/v1`;
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
    if (opts.jwtSecret) this.secret = new TextEncoder().encode(opts.jwtSecret);
  }

  async verifyAccessToken(token: string): Promise<AuthIdentity> {
    let payload: JWTPayload;
    try {
      const { alg } = decodeProtectedHeader(token);
      const options = { issuer: this.issuer, audience: this.opts.audience, clockTolerance: 5 };
      if (alg?.startsWith('HS')) {
        if (!this.secret) throw new InvalidTokenError('HS256-Token, aber SUPABASE_JWT_SECRET ist nicht gesetzt');
        ({ payload } = await jwtVerify(token, this.secret, { ...options, algorithms: ['HS256'] }));
      } else {
        ({ payload } = await jwtVerify(token, this.jwks, { ...options, algorithms: ['ES256', 'RS256'] }));
      }
    } catch (err) {
      if (err instanceof InvalidTokenError) throw err;
      throw new InvalidTokenError();
    }

    if (payload.role !== 'authenticated' || payload.is_anonymous === true) {
      throw new InvalidTokenError('Token gehört zu keinem angemeldeten Nutzer');
    }
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || !payload.email) {
      throw new InvalidTokenError('Token ohne Nutzer-ID oder E-Mail');
    }
    return { authUserId: payload.sub, email: payload.email.toLowerCase() };
  }

  async deleteIdentity(authUserId: string): Promise<void> {
    if (!this.opts.serviceRoleKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY ist nicht gesetzt');
    }
    const res = await fetch(`${this.issuer}/admin/users/${encodeURIComponent(authUserId)}`, {
      method: 'DELETE',
      headers: {
        apikey: this.opts.serviceRoleKey,
        Authorization: `Bearer ${this.opts.serviceRoleKey}`,
      },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Supabase: Löschen fehlgeschlagen (${res.status})`);
    }
  }
}
