import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './index';

const me = {
  id: '6f1c3c2e-8f7a-4c5e-9a55-0d4f0f7a1b11',
  email: 'anna@example.ch',
  firstName: 'Anna',
  lastName: null,
  phone: null,
  avatarUrl: null,
  locale: 'de-CH',
  roles: ['RENTER'],
  status: 'ACTIVE',
  createdAt: '2026-09-29T10:00:00.000Z',
  termsAcceptedAt: null,
  hostProfile: null,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api-client', () => {
  it('sendet das Token und validiert die Antwort', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json(200, me));
    const api = createApiClient({ baseUrl: 'http://api.test/', getAccessToken: async () => 'tok', fetchImpl });
    await expect(api.me.get()).resolves.toEqual(me);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://api.test/v1/me');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('übersetzt API-Fehler und meldet 401', async () => {
    const onUnauthenticated = vi.fn();
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getAccessToken: async () => 'expired',
      onUnauthenticated,
      fetchImpl: async () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Bitte melde dich an' } }),
    });
    const err = await api.me.get().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('UNAUTHENTICATED');
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it('erkennt Netzwerkfehler', async () => {
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getAccessToken: async () => null,
      fetchImpl: async () => {
        throw new TypeError('Network request failed');
      },
    });
    await expect(api.me.get()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('lehnt Antworten ab, die nicht dem Schema entsprechen', async () => {
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getAccessToken: async () => null,
      fetchImpl: async () => json(200, { id: 'x' }),
    });
    await expect(api.me.get()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
