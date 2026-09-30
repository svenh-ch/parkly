import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addresses, bookings, parkingSpots, regions, reviews, users } from '../src/db/schema';
import { pgErrorCode, PG_ERRORS } from '../src/lib/errors';
import { createTestApp, hasTestDb, truncateAll } from './helpers';

/**
 * Prüft die Datenbank-Garantien direkt, unabhängig von der Service-Logik:
 * keine Doppelbuchungen, Bewertungen nur nach eigener, abgeschlossener Buchung.
 */
describe.skipIf(!hasTestDb)('Datenbank-Garantien', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let spotId: string;
  let renterId: string;
  let otherRenterId: string;
  let hostId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await truncateAll(t.db);
    const [host, renter, other] = await t.db
      .insert(users)
      .values([
        { authUserId: crypto.randomUUID(), email: 'host@example.ch' },
        { authUserId: crypto.randomUUID(), email: 'renter@example.ch' },
        { authUserId: crypto.randomUUID(), email: 'other@example.ch' },
      ])
      .returning();
    hostId = host!.id;
    renterId = renter!.id;
    otherRenterId = other!.id;
    const [region] = await t.db
      .insert(regions)
      .values({
        slug: 'zuerich',
        name: 'Zürich',
        countryCode: 'CH',
        currency: 'CHF',
        timezone: 'Europe/Zurich',
        center: { x: 8.54, y: 47.37 },
        minLat: '47.3',
        minLng: '8.4',
        maxLat: '47.5',
        maxLng: '8.7',
        isActive: true,
      })
      .returning();
    const [address] = await t.db
      .insert(addresses)
      .values({
        street: 'Schaffhauserstrasse',
        houseNumber: '100',
        postalCode: '8050',
        city: 'Zürich',
        countryCode: 'CH',
        location: { x: 8.5452, y: 47.4108 },
      })
      .returning();
    const [spot] = await t.db
      .insert(parkingSpots)
      .values({
        hostId,
        regionId: region!.id,
        addressId: address!.id,
        location: { x: 8.5452, y: 47.4108 },
        approxLocation: { x: 8.546, y: 47.4112 },
        title: 'Privatparkplatz Zürich Oerlikon',
        spotType: 'OUTDOOR',
        status: 'ACTIVE',
        priceHourly: 500,
        priceDaily: 2500,
        priceWeekly: 12000,
        priceMonthly: 35000,
        currency: 'CHF',
      })
      .returning();
    spotId = spot!.id;
  });

  const book = (renter: string, start: string, end: string, status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' = 'CONFIRMED') =>
    t.db
      .insert(bookings)
      .values({
        spotId,
        renterId: renter,
        hostId,
        startAt: new Date(start),
        endAt: new Date(end),
        status,
        currency: 'CHF',
        subtotal: 1000,
        total: 1000,
        platformFee: 150,
        hostPayout: 850,
        hostFeeBps: 1500,
        priceBreakdown: [],
      })
      .returning();

  const expectPgError = async (promise: Promise<unknown>, code: string) => {
    try {
      await promise;
      expect.fail('Erwarteter Datenbankfehler blieb aus');
    } catch (err) {
      expect(pgErrorCode(err)).toBe(code);
    }
  };

  it('verhindert überlappende Buchungen', async () => {
    await book(renterId, '2026-10-01T08:00:00Z', '2026-10-01T12:00:00Z');
    await expectPgError(
      book(otherRenterId, '2026-10-01T11:00:00Z', '2026-10-01T13:00:00Z', 'PENDING_PAYMENT'),
      PG_ERRORS.EXCLUSION_VIOLATION,
    );
  });

  it('erlaubt direkt anschliessende Buchungen', async () => {
    await book(renterId, '2026-10-01T08:00:00Z', '2026-10-01T12:00:00Z');
    await expect(book(otherRenterId, '2026-10-01T12:00:00Z', '2026-10-01T14:00:00Z')).resolves.toHaveLength(1);
  });

  it('stornierte Buchungen blockieren nicht', async () => {
    await book(renterId, '2026-10-01T08:00:00Z', '2026-10-01T12:00:00Z', 'CANCELLED');
    await expect(book(otherRenterId, '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z')).resolves.toHaveLength(1);
  });

  it('lässt bei gleichzeitigen Anfragen genau eine Buchung durch', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => book(otherRenterId, '2026-10-02T08:00:00Z', '2026-10-02T09:00:00Z', 'PENDING_PAYMENT')),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('erlaubt Bewertungen nur nach eigener, abgeschlossener Buchung', async () => {
    const [future] = await book(renterId, '2099-01-01T08:00:00Z', '2099-01-01T10:00:00Z');
    await expectPgError(
      t.db.insert(reviews).values({ bookingId: future!.id, spotId, authorId: renterId, rating: 5 }),
      PG_ERRORS.CHECK_VIOLATION,
    );

    const [past] = await book(renterId, '2025-01-01T08:00:00Z', '2025-01-01T10:00:00Z');
    await expectPgError(
      t.db.insert(reviews).values({ bookingId: past!.id, spotId, authorId: otherRenterId, rating: 5 }),
      PG_ERRORS.CHECK_VIOLATION,
    );
    await expect(
      t.db.insert(reviews).values({ bookingId: past!.id, spotId, authorId: renterId, rating: 5, comment: 'Top' }).returning(),
    ).resolves.toHaveLength(1);
    await expectPgError(
      t.db.insert(reviews).values({ bookingId: past!.id, spotId, authorId: renterId, rating: 4 }),
      PG_ERRORS.UNIQUE_VIOLATION,
    );
  });

  it('prüft Beträge der Buchung auf Konsistenz', async () => {
    await expectPgError(
      t.db.insert(bookings).values({
        spotId,
        renterId,
        hostId,
        startAt: new Date('2026-11-01T08:00:00Z'),
        endAt: new Date('2026-11-01T09:00:00Z'),
        currency: 'CHF',
        subtotal: 1000,
        total: 1000,
        platformFee: 150,
        hostPayout: 900, // 150 + 900 != 1000
        hostFeeBps: 1500,
        priceBreakdown: [],
      }),
      PG_ERRORS.CHECK_VIOLATION,
    );
    expect(await t.db.select().from(bookings).where(eq(bookings.spotId, spotId))).toHaveLength(0);
  });
});
