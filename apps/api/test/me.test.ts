import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { createTestApp, hasTestDb, makeToken, truncateAll } from './helpers';

describe.skipIf(!hasTestDb)('Auth & /v1/me', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
  });

  const get = (token?: string) =>
    t.app.inject({ method: 'GET', url: '/v1/me', headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('liefert Health-Status', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });

  it('verweigert Zugriff ohne Token', async () => {
    const res = await get();
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
    expect(res.json().error.requestId).toBeTruthy();
  });

  it('verweigert gefälschte, abgelaufene und fremde Tokens', async () => {
    for (const token of [
      await makeToken({ secret: 'wrong-secret-wrong-secret-wrong-secret-xx' }),
      await makeToken({ expiresIn: '-1m' }),
      await makeToken({ issuer: 'https://evil.example/auth/v1' }),
      await makeToken({ role: 'anon' }),
      'not-a-jwt',
    ]) {
      expect((await get(token)).statusCode).toBe(401);
    }
  });

  it('legt den Nutzer beim ersten Request als RENTER an', async () => {
    const res = await get(await makeToken({ email: 'Anna@Example.ch' }));
    expect(res.statusCode).toBe(200);
    const me = res.json();
    expect(me.email).toBe('anna@example.ch');
    expect(me.roles).toEqual(['RENTER']);
    expect(me.status).toBe('ACTIVE');
  });

  it('legt bei parallelen Requests nur einen Nutzer an', async () => {
    const token = await makeToken({ sub: randomUUID() });
    const results = await Promise.all(Array.from({ length: 8 }, () => get(token)));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(new Set(results.map((r) => r.json().id)).size).toBe(1);
    expect(await t.db.select().from(users)).toHaveLength(1);
  });

  it('validiert Profil-Updates', async () => {
    const token = await makeToken();
    const bad = await t.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { firstName: '', phone: '123', role: 'ADMIN' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');

    const ok = await t.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { firstName: 'Anna', lastName: 'Müller', phone: '+41 79 123 45 67' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ firstName: 'Anna', lastName: 'Müller', phone: '+41791234567' });
  });

  it('kann Rollen nicht über das Profil ändern, aber Vermieter werden', async () => {
    const token = await makeToken();
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/me/host',
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: 'Anna', acceptHostTerms: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().roles).toEqual(['HOST', 'RENTER']);
  });

  it('sperrt gesperrte Konten aus', async () => {
    const token = await makeToken();
    const me = (await get(token)).json();
    await t.db.update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, me.id));
    const res = await get(token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('löscht das Konto und entfernt Personendaten', async () => {
    const sub = randomUUID();
    const token = await makeToken({ sub });
    const me = (await get(token)).json();
    const res = await t.app.inject({ method: 'DELETE', url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(204);
    expect(t.deletedIdentities).toContain(sub);
    const [row] = await t.db.select().from(users).where(eq(users.id, me.id));
    expect(row).toMatchObject({ status: 'DELETED', firstName: null, phone: null });
    expect(row?.email).not.toContain('example.ch');
  });
});
