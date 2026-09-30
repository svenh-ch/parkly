import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { DevPayments, formEncode, StripePayments, verifyStripeSignature } from '../src/adapters/payments';
import { FacilityService, type RegionFile } from '../src/services/facility-service';
import { BookingService } from '../src/services/booking-service';
import { LoyaltyService } from '../src/services/loyalty-service';
import { SpotService } from '../src/services/spot-service';
import { addresses, bookings, parkingSpots, regions, userLoyalty, users } from '../src/db/schema';
import { createTestApp, hasTestDb, makeToken, truncateAll } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('Stripe-Adapter (ohne Netz)', () => {
  it('kodiert verschachtelte Parameter wie Stripe', () => {
    expect(formEncode({ amount: 500, metadata: { a: 'x y' }, expand: ['latest_charge'], automatic_payment_methods: { enabled: true } })).toEqual([
      'amount=500',
      'metadata%5Ba%5D=x%20y',
      'expand%5B0%5D=latest_charge',
      'automatic_payment_methods%5Benabled%5D=true',
    ]);
  });

  it('prüft Webhook-Signaturen', () => {
    const body = '{"id":"evt_1"}';
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', 'whsec_test').update(`${t}.${body}`).digest('hex');
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_test')).toBe(true);
    expect(verifyStripeSignature(body + ' ', `t=${t},v1=${sig}`, 'whsec_test')).toBe(false);
    expect(verifyStripeSignature(body, `t=${t - 1000},v1=${sig}`, 'whsec_test')).toBe(false);
    expect(verifyStripeSignature(body, undefined, 'whsec_test')).toBe(false);
  });

  it('sendet Idempotency-Key und Version, liest Fehler', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/v1/refunds')) return new Response(JSON.stringify({ error: { message: 'Charge already refunded', code: 'charge_already_refunded' } }), { status: 400 });
      return new Response(JSON.stringify({ id: 'pi_1', client_secret: 'pi_1_secret' }), { status: 200 });
    }) as unknown as typeof fetch;
    const s = new StripePayments('sk_test_x', 'pk_test_x', fake, 'http://stripe.test');
    const pi = await s.createIntent({ amount: 1234, currency: 'CHF', customerId: 'cus_1', metadata: { paymentId: 'p1' }, transferGroup: 'booking_1', description: 'x' });
    expect(pi).toEqual({ id: 'pi_1', clientSecret: 'pi_1_secret' });
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h['Idempotency-Key']).toBe('pi-p1');
    expect(h.Authorization).toBe('Bearer sk_test_x');
    expect(String(calls[0]!.init.body)).toContain('currency=chf');
    calls.length = 0;
    const fake2 = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ status: 'requires_action', next_action: { redirect_to_url: { url: 'https://pm-redirects.stripe.com/twint/x' } } }), { status: 200 });
    }) as unknown as typeof fetch;
    const s2 = new StripePayments('sk_test_x', 'pk_test_x', fake2, 'http://stripe.test');
    expect(await s2.confirmTwint('pi_9', 'parkly://payment-return')).toEqual({ redirectUrl: 'https://pm-redirects.stripe.com/twint/x', status: 'requires_action' });
    expect(calls[0]!.url).toBe('http://stripe.test/v1/payment_intents/pi_9/confirm');
    expect(String(calls[0]!.init.body)).toContain('payment_method_data%5Btype%5D=twint');
    await expect(s.refund('pi_1', 100, 'k')).rejects.toMatchObject({ status: 400, code: 'charge_already_refunded' });
  });
});

describe.skipIf(!hasTestDb)('Buchen, bezahlen, Treueprogramm', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  const payments = new DevPayments();
  let svc: BookingService;
  let loyalty: LoyaltyService;
  let host: string;
  let renter: string;
  let other: string;
  let admin: string;
  let hostId: string;
  let renterId: string;
  let otherId: string;
  let spotId: string;
  let requestSpotId: string;

  const call = (method: 'GET' | 'POST', url: string, token: string | null, payload?: unknown) =>
    t.app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

  /** Morgen (oder in n Tagen) um hh:mm UTC, auf 15 Minuten genau. */
  const at = (days: number, hour: number, minute = 0) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    d.setUTCHours(hour, minute, 0, 0);
    return d.toISOString();
  };

  const userId = async (email: string) => (await t.db.select().from(users).where(eq(users.email, email)))[0]!.id;

  async function insertSpot(opts: { instantBook: boolean; lat: number; lng: number }) {
    const [region] = await t.db.select().from(regions).where(eq(regions.slug, 'zug'));
    const [addr] = await t.db
      .insert(addresses)
      .values({ street: 'Baarerstrasse', houseNumber: '14', postalCode: '6300', city: 'Zug', countryCode: 'CH', location: { x: opts.lng, y: opts.lat } })
      .returning();
    const [spot] = await t.db
      .insert(parkingSpots)
      .values({
        hostId,
        regionId: region!.id,
        addressId: addr!.id,
        location: { x: opts.lng, y: opts.lat },
        approxLocation: { x: opts.lng + 0.002, y: opts.lat + 0.001 },
        title: 'Tiefgarage beim Bahnhof',
        spotType: 'UNDERGROUND',
        status: 'ACTIVE',
        spotNumber: '17',
        accessInstructions: 'Fernbedienung im Briefkasten 3',
        priceHourly: 300,
        priceDaily: 1800,
        currency: 'CHF',
        minDurationMinutes: 60,
        leadTimeMinutes: 0,
        access24h: true,
        instantBook: opts.instantBook,
        cancellationPolicy: 'MODERATE',
      })
      .returning();
    return spot!.id;
  }

  beforeAll(async () => {
    t = await createTestApp({ payments });
    await truncateAll(t.db);
    await t.db.execute(sql`insert into loyalty_tiers (tier, rank, min_points, renter_fee_bps, host_fee_bps, early_access_hours) values
      ('BRONZE',0,0,1000,1500,0),('SILVER',1,5,900,1400,12),('GOLD',2,15,800,1300,24),('PLATINUM',3,40,700,1200,48),('DIAMOND',4,100,500,1000,72)`);
    await new FacilityService(t.db).importRegion(JSON.parse(await readFile(path.join(here, '../data/regions/zug.json'), 'utf8')) as RegionFile);
    host = await makeToken({ email: 'host@example.ch' });
    renter = await makeToken({ email: 'renter@example.ch' });
    other = await makeToken({ email: 'other@example.ch' });
    admin = await makeToken({ email: 'admin@example.ch' });
    for (const tok of [renter, other, admin]) await call('GET', '/v1/me', tok);
    expect((await call('POST', '/v1/me/host', host, { displayName: 'Sven', acceptHostTerms: true })).statusCode).toBe(200);
    hostId = await userId('host@example.ch');
    renterId = await userId('renter@example.ch');
    otherId = await userId('other@example.ch');
    await t.db.execute(sql`insert into user_roles (user_id, role) values (${await userId('admin@example.ch')}, 'ADMIN')`);
    spotId = await insertSpot({ instantBook: true, lat: 47.1712, lng: 8.5157 });
    requestSpotId = await insertSpot({ instantBook: false, lat: 47.05, lng: 8.3 });
    loyalty = new LoyaltyService(t.db);
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
    svc = new BookingService(t.db, payments, loyalty, new SpotService(t.db, null), { publicApiUrl: 'http://localhost:4000', payoutDelayHours: 24, allowDevPay: true }, log);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('zeigt die Zahlungs-Konfiguration', async () => {
    expect((await call('GET', '/v1/payments/config', null)).json()).toEqual({ provider: 'dev', publishableKey: null, merchantCountry: 'CH', merchantName: 'Parkly' });
  });

  it('rechnet ein Angebot mit Servicegebühr nach Stufe', async () => {
    const res = await call('POST', `/v1/spots/${spotId}/quote`, renter, { startAt: at(2, 8), endAt: at(2, 10, 30) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ durationMinutes: 150, subtotal: 750, renterFee: 75, total: 825, tier: 'BRONZE', tierSavings: 0, instantBook: true, event: null });
  });

  it('prüft Zeiten und eigene Plätze', async () => {
    expect((await call('POST', `/v1/spots/${spotId}/quote`, renter, { startAt: at(2, 8, 7), endAt: at(2, 10) })).statusCode).toBe(400);
    expect((await call('POST', `/v1/spots/${spotId}/quote`, renter, { startAt: at(2, 8), endAt: at(2, 8, 30) })).statusCode).toBe(400); // unter Mindestdauer
    expect((await call('POST', `/v1/spots/${spotId}/quote`, renter, { startAt: at(-1, 8), endAt: at(-1, 10) })).statusCode).toBe(400);
    expect((await call('POST', `/v1/spots/${spotId}/quote`, host, { startAt: at(2, 8), endAt: at(2, 10) })).statusCode).toBe(409);
  });

  let bookingId: string;

  it('reserviert, blockiert den Zeitraum und bestätigt nach der Zahlung', async () => {
    const res = await call('POST', '/v1/bookings', renter, { spotId, startAt: at(3, 8), endAt: at(3, 10) });
    expect(res.statusCode).toBe(201);
    const { booking, payment } = res.json();
    bookingId = booking.id;
    expect(booking).toMatchObject({ status: 'PENDING_PAYMENT', total: 660 });
    expect(booking.spot.address).toBeNull();
    expect(booking.spot.accessInstructions).toBeNull();
    expect(payment).toMatchObject({ provider: 'dev', amount: 660, currency: 'CHF', clientSecret: null });

    // Gleichzeitig kann niemand anderes diesen Zeitraum buchen
    expect((await call('POST', '/v1/bookings', other, { spotId, startAt: at(3, 9), endAt: at(3, 11) })).statusCode).toBe(409);

    const paid = await call('POST', `/v1/bookings/${bookingId}/dev-pay`, renter);
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({ status: 'CONFIRMED', canCancel: true, canExtend: true });
    expect(paid.json().spot.address).toBe('Baarerstrasse 14, 6300 Zug');
    expect(paid.json().spot.accessInstructions).toContain('Briefkasten');

    // Doppelt bezahlen geht nicht, fremde Buchungen sind unsichtbar
    expect((await call('POST', `/v1/bookings/${bookingId}/dev-pay`, renter)).statusCode).toBe(409);
    expect((await call('GET', `/v1/bookings/${bookingId}`, other)).statusCode).toBe(404);

    const hostList = (await call('GET', '/v1/host/bookings', host)).json().items;
    expect(hostList[0]).toMatchObject({ id: bookingId, role: 'HOST', hostPayout: 510, counterpart: { firstName: null } });
  });

  it('bezahlt mit TWINT (Testmodus) und prüft die Rücksprung-Adresse', async () => {
    const { booking } = (await call('POST', '/v1/bookings', other, { spotId, startAt: at(8, 8), endAt: at(8, 10) })).json();
    expect((await call('POST', `/v1/bookings/${booking.id}/twint`, other, { returnUrl: 'javascript:alert(1)' })).statusCode).toBe(400);
    expect((await call('POST', `/v1/bookings/${booking.id}/twint`, renter, { returnUrl: 'parkly://payment-return' })).statusCode).toBe(404);
    const res = await call('POST', `/v1/bookings/${booking.id}/twint`, other, { returnUrl: 'exp://192.168.1.2:8081/--/payment-return' });
    expect(res.json()).toEqual({ redirectUrl: null });
    const b = (await call('GET', `/v1/bookings/${booking.id}`, other)).json();
    expect(b.status).toBe('CONFIRMED');
    await call('POST', `/v1/bookings/${booking.id}/cancel`, other, {});
  });

  it('verlängert mit Zusatzzahlung', async () => {
    const res = await call('POST', `/v1/bookings/${bookingId}/extend`, renter, { minutes: 60 });
    expect(res.statusCode).toBe(200);
    expect(res.json().quote).toMatchObject({ subtotal: 300, renterFee: 30, total: 330 });
    expect(res.json().payment.amount).toBe(330);
    const b = (await call('POST', `/v1/bookings/${bookingId}/dev-pay`, renter)).json();
    expect(b).toMatchObject({ endAt: at(3, 11), subtotal: 900, renterFee: 90, total: 990, hostPayout: 765 });
  });

  it('storniert kostenlos vor der Frist und erstattet alle Zahlungen', async () => {
    const preview = (await call('GET', `/v1/bookings/${bookingId}/cancel-preview`, renter)).json();
    expect(preview).toMatchObject({ refund: 990, free: true });
    const res = await call('POST', `/v1/bookings/${bookingId}/cancel`, renter, { reason: 'Pläne geändert' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'CANCELLED', refundedAmount: 990, canCancel: false });
    const [row] = await t.db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row!.payoutState).toBe('NONE');
    // Zeitraum ist wieder frei
    expect((await call('POST', `/v1/spots/${spotId}/quote`, other, { startAt: at(3, 9), endAt: at(3, 11) })).statusCode).toBe(200);
  });

  it('gibt unbezahlte Reservierungen nach 15 Minuten frei', async () => {
    const { booking } = (await call('POST', '/v1/bookings', other, { spotId, startAt: at(4, 8), endAt: at(4, 10) })).json();
    expect((await call('POST', `/v1/spots/${spotId}/quote`, renter, { startAt: at(4, 8), endAt: at(4, 10) })).statusCode).toBe(409);
    expect(await svc.expireHolds(new Date(Date.now() + 16 * 60_000))).toBe(1);
    expect((await call('GET', `/v1/bookings/${booking.id}`, other)).json().status).toBe('EXPIRED');
    expect((await call('POST', `/v1/spots/${spotId}/quote`, renter, { startAt: at(4, 8), endAt: at(4, 10) })).statusCode).toBe(200);
  });

  it('Buchung auf Anfrage: Vermieter nimmt an oder lehnt ab', async () => {
    const a = (await call('POST', '/v1/bookings', renter, { spotId: requestSpotId, startAt: at(5, 8), endAt: at(5, 10) })).json().booking;
    const paidA = (await call('POST', `/v1/bookings/${a.id}/dev-pay`, renter)).json();
    expect(paidA.status).toBe('PENDING_APPROVAL');
    expect(paidA.spot.address).toBeNull();
    expect(paidA.approvalDeadline).not.toBeNull();
    expect((await call('POST', `/v1/host/bookings/${a.id}/accept`, host)).json().status).toBe('CONFIRMED');

    const b = (await call('POST', '/v1/bookings', other, { spotId: requestSpotId, startAt: at(6, 8), endAt: at(6, 10) })).json().booking;
    await call('POST', `/v1/bookings/${b.id}/dev-pay`, other);
    const declined = await call('POST', `/v1/host/bookings/${b.id}/decline`, host, {});
    expect(declined.json()).toMatchObject({ status: 'CANCELLED', refundedAmount: b.total });

    // Ohne Antwort: nach Ablauf der Frist automatisch storniert und erstattet
    const c = (await call('POST', '/v1/bookings', other, { spotId: requestSpotId, startAt: at(7, 8), endAt: at(7, 10) })).json().booking;
    await call('POST', `/v1/bookings/${c.id}/dev-pay`, other);
    expect(await svc.expireApprovals(new Date(Date.now() + 25 * 3_600_000))).toBe(1);
    expect((await call('GET', `/v1/bookings/${c.id}`, other)).json()).toMatchObject({ status: 'CANCELLED', refundedAmount: c.total });
  });

  it('schliesst ab, zählt Punkte (mit Regeln gegen Tricks) und zahlt aus', async () => {
    const later = new Date(Date.now() + 9 * 24 * 3_600_000);
    const done = await svc.completeFinished(later);
    expect(done).toBeGreaterThanOrEqual(1);
    expect((await loyalty.summary(renterId, later)).points).toBe(1);

    // 7 abgeschlossene Buchungen mit derselben Person zählen nur 5; zu kurze und zu billige gar nicht
    const base = Date.now() - 30 * 24 * 3_600_000;
    for (let i = 0; i < 9; i++) {
      const start = new Date(base + i * 24 * 3_600_000);
      const short = i === 7;
      const cheap = i === 8;
      await t.db.insert(bookings).values({
        spotId,
        renterId: otherId,
        hostId,
        startAt: start,
        endAt: new Date(start.getTime() + (short ? 30 : 120) * 60_000),
        status: 'COMPLETED',
        completedAt: new Date(start.getTime() + 3 * 3_600_000),
        currency: 'CHF',
        subtotal: cheap ? 400 : 600,
        renterFee: 0,
        total: cheap ? 400 : 600,
        platformFee: cheap ? 60 : 90,
        hostPayout: cheap ? 340 : 510,
        hostFeeBps: 1500,
        priceBreakdown: { lines: [], cancellationPolicy: 'MODERATE', instantBook: true },
        payoutState: 'TRANSFERRED',
      });
    }
    const o = await loyalty.summary(otherId);
    expect(o).toMatchObject({ tier: 'SILVER', points: 5, pointsToNext: 10, next: { tier: 'GOLD' } });
    expect(new Date(o.heldUntil!).getTime()).toBeGreaterThan(Date.now() + 360 * 24 * 3_600_000);
    expect((await call('GET', '/v1/me/loyalty', other)).json().tier).toBe('SILVER');
    // Der Vermieter bekommt Punkte als Vermieter (5 von other, 1 von renter)
    expect((await loyalty.summary(hostId)).points).toBe(6);
    expect((await call('GET', '/v1/host/fee', host)).json()).toEqual({ hostFeeBps: 1400, renterFeeBps: 1000 });

    // Silber zahlt 9 % statt 10 %
    const q = (await call('POST', `/v1/spots/${spotId}/quote`, other, { startAt: at(10, 8), endAt: at(10, 12) })).json();
    expect(q).toMatchObject({ subtotal: 1200, renterFee: 110, tier: 'SILVER', tierSavings: 10 });

    // Auszahlung 24 h nach Ende
    const payout = await svc.processPayouts(new Date(later.getTime() + 25 * 3_600_000));
    expect(payout.transferred).toBeGreaterThanOrEqual(1);
    const account = (await call('GET', '/v1/host/payouts', host)).json();
    expect(account).toMatchObject({ provider: 'dev', connected: false });
    expect(account.transferredAmount).toBeGreaterThan(0);
  });

  it('eine erreichte Stufe gilt 12 Monate, auch wenn Punkte verfallen', async () => {
    await t.db.update(userLoyalty).set({ tier: 'GOLD', tierHeldUntil: new Date(Date.now() + 100 * 24 * 3_600_000) }).where(eq(userLoyalty.userId, otherId));
    expect((await loyalty.recompute(otherId)).tier).toBe('GOLD');
    await t.db.update(userLoyalty).set({ tierHeldUntil: new Date(Date.now() - 1000) }).where(eq(userLoyalty.userId, otherId));
    expect((await loyalty.current(otherId)).tier).toBe('SILVER');
  });

  it('Events: höhere Stufen dürfen früher buchen', async () => {
    const ev = await call('POST', '/v1/admin/events', admin, {
      name: 'EVZ Heimspiel',
      lat: 47.1712,
      lng: 8.5157,
      radiusMeters: 1500,
      startsAt: at(12, 18),
      endsAt: at(12, 22),
      publicOpenAt: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    });
    expect(ev.statusCode).toBe(201);
    expect((await call('POST', '/v1/admin/events', renter, ev.json())).statusCode).toBe(403);

    // Bronze: noch nicht
    const q = (await call('POST', `/v1/spots/${spotId}/quote`, renter, { startAt: at(12, 17), endAt: at(12, 23) })).json();
    expect(q.event).toMatchObject({ name: 'EVZ Heimspiel', canBookNow: false });
    const denied = await call('POST', '/v1/bookings', renter, { spotId, startAt: at(12, 17), endAt: at(12, 23) });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.message).toContain('EVZ Heimspiel');

    // Silber (12 h Vorkauf): schon jetzt
    const ok = await call('POST', '/v1/bookings', other, { spotId, startAt: at(12, 17), endAt: at(12, 23) });
    expect(ok.statusCode).toBe(201);
    expect((await call('GET', '/v1/events', other)).json().items[0].yourAccessAt).not.toBeNull();
  });
});
