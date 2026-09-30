import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DevStorage, sniffImageType } from '../src/adapters/storage';
import { approximate } from '../src/services/spot-service';
import { FacilityService, type RegionFile } from '../src/services/facility-service';
import { distanceMeters, hostPayout } from '@parking/shared';
import { createTestApp, hasTestDb, makeToken, truncateAll } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]), Buffer.alloc(2000, 7)]);

describe('Hilfen', () => {
  it('erkennt Bildtypen an den ersten Bytes', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImageType(Buffer.from('RIFF1234WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(Buffer.from('<?php echo 1; ?>'))).toBeNull();
  });

  it('verschiebt die öffentliche Position um 120 bis 250 m', () => {
    for (let i = 0; i < 50; i++) {
      const d = distanceMeters({ lat: 47.17, lng: 8.51 }, approximate({ lat: 47.17, lng: 8.51 }));
      expect(d).toBeGreaterThan(110);
      expect(d).toBeLessThan(260);
    }
  });

  it('rechnet die Auszahlung nach Gebühr', () => {
    expect(hostPayout(1000, 1500)).toBe(850);
    expect(hostPayout(333, 1500)).toBe(283);
  });
});

describe.skipIf(!hasTestDb)('Parkplatz inserieren', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let storage: DevStorage;
  let host: string;
  let renter: string;
  let spotId: string;

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, token: string | null, payload?: unknown) =>
    t.app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

  const upload = async (bytes: Buffer, kind = 'FRONT') => {
    const ticket = await call('POST', `/v1/host/spots/${spotId}/images`, host, { kind, mimeType: 'image/jpeg', bytes: bytes.length, width: 1600, height: 1200 });
    expect(ticket.statusCode).toBe(201);
    const { image, upload: u } = ticket.json();
    const url = new URL(u.url);
    const put = await t.app.inject({ method: 'PUT', url: url.pathname + url.search, headers: u.headers, payload: bytes });
    expect(put.statusCode).toBe(200);
    return call('POST', `/v1/host/spots/${spotId}/images/${image.id}/complete`, host);
  };

  beforeAll(async () => {
    storage = new DevStorage(await mkdtemp(path.join(os.tmpdir(), 'parkly-')), 'http://localhost:4000', 'x'.repeat(40));
    t = await createTestApp({ storage });
    await truncateAll(t.db);
    await new FacilityService(t.db).importRegion(JSON.parse(await readFile(path.join(here, '../data/regions/zug.json'), 'utf8')) as RegionFile);
    await t.db.execute(
      (await import('drizzle-orm')).sql`insert into platform_fee_rules (host_fee_bps) values (1500)`,
    );
    host = await makeToken({ email: 'host@example.ch' });
    renter = await makeToken({ email: 'renter@example.ch' });
    await call('GET', '/v1/me', renter);
    const becameHost = await call('POST', '/v1/me/host', host, { displayName: 'Sven', acceptHostTerms: true });
    expect(becameHost.statusCode).toBe(200);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('nur Vermieter dürfen inserieren', async () => {
    const res = await call('POST', '/v1/host/spots', renter, { address: { street: 'Baarerstrasse', houseNumber: '1', postalCode: '6300', city: 'Zug' }, location: { lat: 47.17, lng: 8.51 } });
    expect(res.statusCode).toBe(403);
  });

  it('legt einen Entwurf an und zeigt, was fürs Veröffentlichen fehlt', async () => {
    const res = await call('POST', '/v1/host/spots', host, {
      address: { street: 'Baarerstrasse', houseNumber: '14', postalCode: '6300', city: 'Zug' },
      location: { lat: 47.1712, lng: 8.5157 },
      spotType: 'UNDERGROUND',
      floor: '-2',
      spotNumber: '17',
    });
    expect(res.statusCode).toBe(201);
    const s = res.json();
    spotId = s.id;
    expect(s).toMatchObject({ status: 'DRAFT', title: 'Parkplatz in Zug', floor: '-2', vehicleTypes: ['CAR'], currency: 'CHF' });
    expect(s.publishIssues).toEqual(['PRICE', 'IMAGES', 'AVAILABILITY', 'RIGHTS']);
    expect(distanceMeters(s.location, s.approxLocation)).toBeGreaterThan(100);
    expect((await call('GET', '/v1/host/fee', host)).json()).toEqual({ hostFeeBps: 1500, renterFeeBps: 1000 });
  });

  it('prüft Eingaben', async () => {
    expect((await call('PATCH', `/v1/host/spots/${spotId}`, host, { prices: { hourly: 50, daily: null, weekly: null, monthly: null } })).statusCode).toBe(400);
    expect((await call('PATCH', `/v1/host/spots/${spotId}`, host, { location: { lat: 48.5, lng: 8.5 } })).statusCode).toBe(400);
    expect((await call('PATCH', `/v1/host/spots/${spotId}`, host, { minDurationMinutes: 600, maxDurationMinutes: 60 })).statusCode).toBe(400);
    expect((await call('PATCH', `/v1/host/spots/${spotId}`, renter, { title: 'Fremder Platz' })).statusCode).toBe(403);
  });

  it('lädt Fotos hoch und prüft sie serverseitig', async () => {
    const ok = await upload(JPEG);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'READY' });
    expect(ok.json().url).toContain('/dev-storage/object/spots/');

    // Datei, die kein Bild ist, wird abgelehnt und gelöscht
    const bad = await upload(Buffer.from('<script>alert(1)</script>'.repeat(10)));
    expect(bad.statusCode).toBe(400);

    // "fertig" melden, ohne hochgeladen zu haben
    const ticket = (await call('POST', `/v1/host/spots/${spotId}/images`, host, { kind: 'TOP', mimeType: 'image/jpeg', bytes: 100, width: 10, height: 10 })).json();
    expect((await call('POST', `/v1/host/spots/${spotId}/images/${ticket.image.id}/complete`, host)).statusCode).toBe(409);
    await call('DELETE', `/v1/host/spots/${spotId}/images/${ticket.image.id}`, host);

    // zu gross wird schon bei der Anfrage abgelehnt
    expect((await call('POST', `/v1/host/spots/${spotId}/images`, host, { kind: 'TOP', mimeType: 'image/jpeg', bytes: 11 * 1024 * 1024, width: 10, height: 10 })).statusCode).toBe(400);
    expect((await call('POST', `/v1/host/spots/${spotId}/images`, host, { kind: 'TOP', mimeType: 'image/gif', bytes: 100, width: 10, height: 10 })).statusCode).toBe(400);

    expect((await upload(JPEG, 'ACCESS')).statusCode).toBe(200);
    expect((await upload(JPEG, 'ENTRANCE')).statusCode).toBe(200);
    const spot = (await call('GET', `/v1/host/spots/${spotId}`, host)).json();
    expect(spot.images.filter((i: { status: string }) => i.status === 'READY')).toHaveLength(3);
    expect(spot.publishIssues).not.toContain('IMAGES');
  });

  it('ändert Reihenfolge und Titelbild', async () => {
    const spot = (await call('GET', `/v1/host/spots/${spotId}`, host)).json();
    const ids = spot.images.map((i: { id: string }) => i.id);
    const res = await call('PUT', `/v1/host/spots/${spotId}/images/order`, host, {
      items: [{ id: ids[2], kind: 'FRONT' }, { id: ids[0], kind: 'GARAGE' }, { id: ids[1], kind: 'ACCESS' }],
    });
    expect(res.json().images.map((i: { id: string; kind: string }) => [i.id, i.kind])).toEqual([
      [ids[2], 'FRONT'],
      [ids[0], 'GARAGE'],
      [ids[1], 'ACCESS'],
    ]);
  });

  it('veröffentlicht erst, wenn alles da ist', async () => {
    const early = await call('POST', `/v1/host/spots/${spotId}/publish`, host);
    expect(early.statusCode).toBe(422);
    expect(early.json().error.details.issues).toEqual(['PRICE', 'AVAILABILITY', 'RIGHTS']);

    await call('PATCH', `/v1/host/spots/${spotId}`, host, {
      title: 'Tiefgarage beim Bahnhof Zug',
      description: 'Breiter Platz, 3 Minuten zum Bahnhof.',
      prices: { hourly: 300, daily: 1800, weekly: null, monthly: 16000 },
      vehicleTypes: ['SMALL_CAR', 'CAR', 'SUV'],
      hasEvCharging: true,
      evConnector: 'TYPE2',
      evPowerKw: 11,
      accessMethod: 'REMOTE',
      accessInstructions: 'Fernbedienung liegt im Briefkasten 3.',
      rightsConfirmed: true,
    });
    await call('PUT', `/v1/host/spots/${spotId}/availability`, host, {
      access24h: false,
      rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 7 * 60, endMinute: 19 * 60 })),
    });
    const res = await call('POST', `/v1/host/spots/${spotId}/publish`, host);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ACTIVE', publishIssues: [] });
  });

  it('zeigt veröffentlichte Plätze auf der Karte mit Preis, nur ungefähr', async () => {
    const map = (await call('GET', '/v1/map?minLng=8.49&minLat=47.16&maxLng=8.54&maxLat=47.19&zoom=15', null)).json();
    const pin = map.items.find((i: { id: string }) => i.id === spotId);
    expect(pin).toMatchObject({ kind: 'PRIVATE_MARKETPLACE_PARKING', name: 'Tiefgarage beim Bahnhof Zug', price: { amount: 300, unit: 'HOUR' } });
    expect(distanceMeters(pin, { lat: 47.1712, lng: 8.5157 })).toBeGreaterThan(100);
  });

  it('öffentliche Detailseite ohne Adresse, Platznummer und Zugang', async () => {
    const res = await call('GET', `/v1/spots/${spotId}`, renter);
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d).toMatchObject({ area: '6300 Zug', host: { firstName: null }, evPowerKw: 11, isOwn: false });
    expect(d.images).toHaveLength(3);
    const text = JSON.stringify(d);
    expect(text).not.toContain('Briefkasten');
    expect(text).not.toContain('Baarerstrasse');
    expect(text).not.toContain('"17"');
  });

  it('schützt aktive Inserate vor unvollständigen Änderungen', async () => {
    expect((await call('PATCH', `/v1/host/spots/${spotId}`, host, { prices: { hourly: null, daily: null, weekly: null, monthly: null } })).statusCode).toBe(409);
    const spot = (await call('GET', `/v1/host/spots/${spotId}`, host)).json();
    expect((await call('DELETE', `/v1/host/spots/${spotId}/images/${spot.images[0].id}`, host)).statusCode).toBe(409);
  });

  it('pausiert, listet und löscht', async () => {
    expect((await call('POST', `/v1/host/spots/${spotId}/pause`, host)).json().status).toBe('PAUSED');
    expect((await call('GET', `/v1/spots/${spotId}`, renter)).statusCode).toBe(404);
    const list = (await call('GET', '/v1/host/spots', host)).json().items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'PAUSED', imageCount: 3 });
    expect(list[0].coverUrl).toContain('/dev-storage/object/');
    expect((await call('DELETE', `/v1/host/spots/${spotId}`, host)).statusCode).toBe(204);
    expect((await call('GET', '/v1/host/spots', host)).json().items).toHaveLength(0);
  });
});
