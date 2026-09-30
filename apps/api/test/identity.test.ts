import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { InvalidTokenError, SupabaseIdentityProvider } from '../src/adapters/identity';

/**
 * Neue Supabase-Projekte signieren Access Tokens asymmetrisch (ES256) und veröffentlichen
 * den Public Key als JWKS. Dieser Test simuliert den JWKS-Endpunkt lokal.
 */
describe('SupabaseIdentityProvider (ES256 / JWKS)', () => {
  let server: http.Server;
  let baseUrl: string;
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256');
    privateKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
    server = http.createServer((req, res) => {
      if (req.url === '/auth/v1/.well-known/jwks.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ keys: [jwk] }));
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const sign = (claims: Record<string, unknown> = {}, issuer = `${baseUrl}/auth/v1`) =>
    new SignJWT({ email: 'Lea@Example.ch', role: 'authenticated', ...claims })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setSubject('7a1d1c55-2a38-4a1f-8d0a-7a3c7f0f6d11')
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);

  it('akzeptiert gültige Tokens', async () => {
    const provider = new SupabaseIdentityProvider({ supabaseUrl: baseUrl, audience: 'authenticated' });
    await expect(provider.verifyAccessToken(await sign())).resolves.toEqual({
      authUserId: '7a1d1c55-2a38-4a1f-8d0a-7a3c7f0f6d11',
      email: 'lea@example.ch',
    });
  });

  it('lehnt anonyme Sessions und fremde Issuer ab', async () => {
    const provider = new SupabaseIdentityProvider({ supabaseUrl: baseUrl, audience: 'authenticated' });
    await expect(provider.verifyAccessToken(await sign({ is_anonymous: true }))).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(provider.verifyAccessToken(await sign({}, 'https://evil.example/auth/v1'))).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it('lehnt HS256-Tokens ab, wenn kein Secret konfiguriert ist (kein Algorithmus-Downgrade)', async () => {
    const provider = new SupabaseIdentityProvider({ supabaseUrl: baseUrl, audience: 'authenticated' });
    const hs = await new SignJWT({ email: 'x@example.ch', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('7a1d1c55-2a38-4a1f-8d0a-7a3c7f0f6d11')
      .setIssuer(`${baseUrl}/auth/v1`)
      .setAudience('authenticated')
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('some-secret-some-secret-some-secret-xx'));
    await expect(provider.verifyAccessToken(hs)).rejects.toBeInstanceOf(InvalidTokenError);
  });
});
