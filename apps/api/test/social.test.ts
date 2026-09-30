import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { dataSources, parkingFacilities, regions, reports, reviews, userRoles } from '../src/db/schema';
import { FacilityService, PLS_SOURCE_KEY } from '../src/services/facility-service';
import { createTestApp, hasTestDb, makeToken, truncateAll } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const zurich = { minLng: 8.44, minLat: 47.32, maxLng: 8.63, maxLat: 47.44 };

describe.skipIf(!hasTestDb)('Favoriten und Bewertungen', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let anna: { token: string; id: string };
  let ben: { token: string; id: string };
  let accuId: string;
  let centralId: string;

  const as = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});
  const signUp = async (email: string, firstName: string, lastName: string) => {
    const token = await makeToken({ sub: randomUUID(), email });
    const me = (
      await t.app.inject({ method: 'PATCH', url: '/v1/me', headers: as(token), payload: { firstName, lastName } })
    ).json();
    return { token, id: me.id as string };
  };

  beforeAll(async () => {
    t = await createTestApp();
    await truncateAll(t.db);
    await t.db.insert(regions).values({
      slug: 'zuerich',
      name: 'Zürich',
      countryCode: 'CH',
      currency: 'CHF',
      timezone: 'Europe/Zurich',
      center: { x: 8.54, y: 47.37 },
      minLat: '47.32',
      minLng: '8.44',
      maxLat: '47.44',
      maxLng: '8.63',
      isActive: true,
    });
    await t.db.insert(dataSources).values({ key: PLS_SOURCE_KEY, name: 'PLS', license: 'CC0-1.0' });
    await new FacilityService(t.db).importPlsLocations(path.join(here, '../data/zuerich-parkleitsystem.geojson'));
    const all = await t.db.select().from(parkingFacilities);
    accuId = all.find((f) => f.name === 'Parkhaus Accu')!.id;
    centralId = all.find((f) => f.name === 'Parkgarage am Central')!.id;
    anna = await signUp('anna@example.ch', 'Anna', 'Müller');
    ben = await signUp('ben@example.ch', 'Ben', 'Keller');
  });
  afterAll(async () => {
    await t.close();
  });

  const map = (q: Record<string, string | number>, token?: string) =>
    t.app.inject({
      method: 'GET',
      url: '/v1/map',
      headers: as(token),
      query: Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])),
    });

  describe('Favoriten', () => {
    it('verlangt Login', async () => {
      const res = await t.app.inject({ method: 'PUT', url: `/v1/favorites/PUBLIC_PARKING/${accuId}` });
      expect(res.statusCode).toBe(401);
    });

    it('speichert idempotent und markiert Pins', async () => {
      for (let i = 0; i < 2; i++) {
        const res = await t.app.inject({ method: 'PUT', url: `/v1/favorites/PUBLIC_PARKING/${accuId}`, headers: as(anna.token) });
        expect(res.statusCode).toBe(204);
      }
      const items = (await map({ ...zurich, zoom: 13 }, anna.token)).json().items;
      expect(items.find((i: { id: string }) => i.id === accuId).isFavorite).toBe(true);
      expect(items.filter((i: { isFavorite: boolean }) => i.isFavorite)).toHaveLength(1);
      // Favoriten liegen vorne (werden über anderen Pins gezeichnet)
      expect(items[0].id).toBe(accuId);
    });

    it('zeigt Favoriten nur dem Besitzer und nicht anonym', async () => {
      const forBen = (await map({ ...zurich, zoom: 13 }, ben.token)).json().items;
      expect(forBen.some((i: { isFavorite: boolean }) => i.isFavorite)).toBe(false);
      const anon = await map({ ...zurich, zoom: 13 });
      expect(anon.json().items.some((i: { isFavorite: boolean }) => i.isFavorite)).toBe(false);
      expect(anon.headers['cache-control']).toContain('public');
      expect((await map({ ...zurich, zoom: 13 }, anna.token)).headers['cache-control']).toBe('private, no-store');
    });

    it('ignoriert ungültige Tokens auf öffentlichen Endpunkten', async () => {
      const res = await map({ ...zurich, zoom: 13 }, 'kaputt');
      expect(res.statusCode).toBe(200);
    });

    it('clustert Favoriten nie, auch nicht in der Weltansicht', async () => {
      const body = (await map({ minLng: -180, minLat: -85, maxLng: 180, maxLat: 85, zoom: 2 }, anna.token)).json();
      expect(body.mode).toBe('clusters');
      expect(body.items.map((i: { id: string }) => i.id)).toEqual([accuId]);
      const clustered = body.clusters.reduce((s: number, c: { count: number }) => s + c.count, 0);
      expect(clustered).toBe(33); // 34 Parkhäuser minus der Favorit
    });

    it('filtert auf Favoriten', async () => {
      const body = (await map({ ...zurich, zoom: 13, favoritesOnly: 'true' }, anna.token)).json();
      expect(body.items.map((i: { id: string }) => i.id)).toEqual([accuId]);
    });

    it('listet Favoriten mit Distanz und entfernt sie', async () => {
      await t.app.inject({ method: 'PUT', url: `/v1/favorites/PUBLIC_PARKING/${centralId}`, headers: as(anna.token) });
      const list = (
        await t.app.inject({ method: 'GET', url: '/v1/favorites?lat=47.3767&lng=8.5439', headers: as(anna.token) })
      ).json().items;
      expect(list.map((i: { name: string }) => i.name)).toEqual(['Parkgarage am Central', 'Parkhaus Accu']);
      expect(list[0].distanceMeters).toBeLessThan(200);

      await t.app.inject({ method: 'DELETE', url: `/v1/favorites/PUBLIC_PARKING/${centralId}`, headers: as(anna.token) });
      const after = (await t.app.inject({ method: 'GET', url: '/v1/favorites', headers: as(anna.token) })).json().items;
      expect(after).toHaveLength(1);
      expect(after[0].distanceMeters).toBeNull();
    });

    it('lehnt unbekannte Ziele ab', async () => {
      const res = await t.app.inject({ method: 'PUT', url: `/v1/favorites/PUBLIC_PARKING/${randomUUID()}`, headers: as(anna.token) });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('Bewertungen', () => {
    const upsert = (token: string, body: unknown, facilityId = accuId) =>
      t.app.inject({ method: 'PUT', url: `/v1/facilities/${facilityId}/reviews/mine`, headers: as(token), payload: body as object });

    it('validiert Sterne und Kommentarlänge', async () => {
      expect((await upsert(anna.token, { rating: 6 })).statusCode).toBe(400);
      expect((await upsert(anna.token, { rating: 4, comment: 'x'.repeat(1001) })).statusCode).toBe(400);
    });

    it('legt eine Bewertung pro Nutzer an und aktualisiert sie', async () => {
      const first = await upsert(anna.token, { rating: 4, comment: '  Gut erreichbar  ' });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ rating: 4, comment: 'Gut erreichbar', authorName: 'Anna M.', isMine: true });

      const second = await upsert(anna.token, { rating: 5, comment: '' });
      expect(second.json()).toMatchObject({ id: first.json().id, rating: 5, comment: null });
      expect(await t.db.select().from(reviews).where(eq(reviews.authorId, anna.id))).toHaveLength(1);
    });

    it('berechnet Durchschnitt und Anzahl', async () => {
      await upsert(ben.token, { rating: 2, comment: 'Eng' });
      const detail = (await t.app.inject({ method: 'GET', url: `/v1/facilities/${accuId}` })).json();
      expect(detail.rating).toEqual({ avg: 3.5, count: 2 });
      const item = (await map({ ...zurich, zoom: 13 })).json().items.find((i: { id: string }) => i.id === accuId);
      expect(item.rating).toEqual({ avg: 3.5, count: 2 });
    });

    it('listet neueste zuerst, mit eigener Bewertung separat', async () => {
      const res = (
        await t.app.inject({ method: 'GET', url: `/v1/facilities/${accuId}/reviews?limit=1`, headers: as(anna.token) })
      ).json();
      expect(res.items).toHaveLength(1);
      expect(res.items[0].authorName).toBe('Ben K.');
      expect(res.nextCursor).not.toBeNull();
      expect(res.mine).toMatchObject({ authorName: 'Anna M.', isMine: true });

      const page2 = (
        await t.app.inject({ method: 'GET', url: `/v1/facilities/${accuId}/reviews?limit=1&before=${encodeURIComponent(res.nextCursor)}` })
      ).json();
      expect(page2.items[0].authorName).toBe('Anna M.');
      expect(page2.mine).toBeNull();
    });

    it('zeigt meine Bewertungen im Profil', async () => {
      const mine = (await t.app.inject({ method: 'GET', url: '/v1/me/reviews', headers: as(anna.token) })).json().items;
      expect(mine).toEqual([expect.objectContaining({ rating: 5, target: { kind: 'PUBLIC_PARKING', id: accuId, name: 'Parkhaus Accu' } })]);
    });

    it('erlaubt Melden fremder, aber nicht eigener Bewertungen', async () => {
      const [benReview] = await t.db.select().from(reviews).where(eq(reviews.authorId, ben.id));
      const [annaReview] = await t.db.select().from(reviews).where(eq(reviews.authorId, anna.id));
      const own = await t.app.inject({
        method: 'POST',
        url: `/v1/reviews/${annaReview!.id}/report`,
        headers: as(anna.token),
        payload: { reason: 'SPAM' },
      });
      expect(own.statusCode).toBe(400);
      for (let i = 0; i < 2; i++) {
        const res = await t.app.inject({
          method: 'POST',
          url: `/v1/reviews/${benReview!.id}/report`,
          headers: as(anna.token),
          payload: { reason: 'OFFENSIVE', details: 'Beleidigend' },
        });
        expect(res.statusCode).toBe(204);
      }
      expect(await t.db.select().from(reports)).toHaveLength(1);
    });

    it('nur Admins können ausblenden; Durchschnitt wird neu berechnet', async () => {
      const [benReview] = await t.db.select().from(reviews).where(eq(reviews.authorId, ben.id));
      const url = `/v1/admin/reviews/${benReview!.id}`;
      expect((await t.app.inject({ method: 'PATCH', url, headers: as(anna.token), payload: { status: 'HIDDEN' } })).statusCode).toBe(403);

      await t.db.insert(userRoles).values({ userId: anna.id, role: 'ADMIN' });
      expect((await t.app.inject({ method: 'PATCH', url, headers: as(anna.token), payload: { status: 'HIDDEN' } })).statusCode).toBe(204);

      const detail = (await t.app.inject({ method: 'GET', url: `/v1/facilities/${accuId}` })).json();
      expect(detail.rating).toEqual({ avg: 5, count: 1 });
      const list = (await t.app.inject({ method: 'GET', url: `/v1/facilities/${accuId}/reviews` })).json();
      expect(list.items.map((r: { authorName: string }) => r.authorName)).toEqual(['Anna M.']);
    });

    it('löscht die eigene Bewertung', async () => {
      const res = await t.app.inject({ method: 'DELETE', url: `/v1/facilities/${accuId}/reviews/mine`, headers: as(anna.token) });
      expect(res.statusCode).toBe(204);
      const detail = (await t.app.inject({ method: 'GET', url: `/v1/facilities/${accuId}` })).json();
      expect(detail.rating).toEqual({ avg: null, count: 0 });
    });
  });

  it('liefert das Vermieterprofil in /me', async () => {
    await t.app.inject({ method: 'POST', url: '/v1/me/host', headers: as(ben.token), payload: { displayName: 'Ben', acceptHostTerms: true } });
    const me = (await t.app.inject({ method: 'GET', url: '/v1/me', headers: as(ben.token) })).json();
    expect(me.hostProfile).toMatchObject({ displayName: 'Ben', onboardingStatus: 'NOT_STARTED', payoutsEnabled: false });
  });
});
