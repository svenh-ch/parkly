import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  distanceMeters,
  ERROR_CODES,
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  SPOT_MAX_IMAGES,
  SPOT_MIN_IMAGES,
  type CreateSpotInput,
  type HostFee,
  type HostSpot,
  type HostSpotListItem,
  type ImageUploadTicket,
  type PublishIssue,
  type ReorderImagesInput,
  type RequestImageUploadInput,
  type SpotAvailabilityInput,
  type SpotDetail,
  type SpotImage,
  type UpdateSpotInput,
} from '@parking/shared';
import type { Database } from '../db/client';
import { addresses, availabilityRules, bookings, images, parkingSpots, regions } from '../db/schema';
import { AppError } from '../lib/errors';
import { sniffImageType, type StorageProvider } from '../adapters/storage';

type SpotRow = typeof parkingSpots.$inferSelect;
type ImageRow = typeof images.$inferSelect;

const READ_URL_TTL_S = 60 * 60;

/** Zufällige Verschiebung 120–250 m: öffentliche Position verrät die genaue Adresse nicht. */
export function approximate(p: { lat: number; lng: number }, rand = Math.random): { lat: number; lng: number } {
  const angle = rand() * 2 * Math.PI;
  const meters = 120 + rand() * 130;
  const dLat = (meters * Math.cos(angle)) / 110_574;
  const dLng = (meters * Math.sin(angle)) / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  return { lat: p.lat + dLat, lng: p.lng + dLng };
}

export class SpotService {
  private urlCache = new Map<string, { url: string; exp: number }>();

  constructor(
    private readonly db: Database,
    private readonly storage: StorageProvider | null,
  ) {}

  // ─── Hilfen ────────────────────────────────────────────────────────────

  private requireStorage(): StorageProvider {
    if (!this.storage) {
      throw new AppError(503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Foto-Speicher ist nicht eingerichtet (SUPABASE_SERVICE_ROLE_KEY fehlt).');
    }
    return this.storage;
  }

  private async own(hostId: string, spotId: string): Promise<SpotRow> {
    const [spot] = await this.db.select().from(parkingSpots).where(eq(parkingSpots.id, spotId));
    if (!spot || spot.hostId !== hostId) throw AppError.notFound('Parkplatz nicht gefunden');
    return spot;
  }

  private async regionFor(p: { lat: number; lng: number }) {
    const rows = await this.db
      .select({ id: regions.id, currency: regions.currency, center: regions.center, minLat: regions.minLat, maxLat: regions.maxLat, minLng: regions.minLng, maxLng: regions.maxLng })
      .from(regions)
      .where(eq(regions.isActive, true));
    if (!rows.length) throw new AppError(503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Keine Region eingerichtet');
    const inside = rows.find(
      (r) => p.lat >= Number(r.minLat) && p.lat <= Number(r.maxLat) && p.lng >= Number(r.minLng) && p.lng <= Number(r.maxLng),
    );
    if (inside) return inside;
    // Ausserhalb aller Regionen: nächstgelegene Region (die Schweiz ist klein)
    return rows.reduce((best, r) =>
      distanceMeters(p, { lat: r.center.y, lng: r.center.x }) < distanceMeters(p, { lat: best.center.y, lng: best.center.x }) ? r : best,
    );
  }

  private async signed(keys: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!this.storage || !keys.length) return out;
    const now = Date.now() / 1000;
    const missing: string[] = [];
    for (const k of keys) {
      const hit = this.urlCache.get(k);
      if (hit && hit.exp - now > 10 * 60) out.set(k, hit.url);
      else missing.push(k);
    }
    if (missing.length) {
      try {
        const fresh = await this.storage.signedReadUrls(missing, READ_URL_TTL_S);
        for (const [k, url] of fresh) {
          out.set(k, url);
          this.urlCache.set(k, { url, exp: now + READ_URL_TTL_S });
        }
      } catch {
        // Bilder vorübergehend ohne URL statt Fehlerseite
      }
      if (this.urlCache.size > 5000) this.urlCache.clear();
    }
    return out;
  }

  private async imagesFor(spotIds: string[], onlyReady: boolean) {
    if (!spotIds.length) return new Map<string, SpotImage[]>();
    const rows = await this.db
      .select()
      .from(images)
      .where(
        and(
          inArray(images.spotId, spotIds),
          onlyReady ? eq(images.status, 'READY') : inArray(images.status, ['READY', 'PENDING_UPLOAD']),
        ),
      )
      .orderBy(asc(images.position), asc(images.createdAt));
    const urls = await this.signed(rows.filter((r) => r.status === 'READY').map((r) => r.storageKey));
    const map = new Map<string, SpotImage[]>();
    for (const r of rows) {
      const list = map.get(r.spotId) ?? [];
      list.push(this.imageDto(r, urls.get(r.storageKey) ?? null));
      map.set(r.spotId, list);
    }
    return map;
  }

  /** Titelbild-URLs (erstes fertiges Foto) für Listen wie "Meine Buchungen". */
  async covers(spotIds: string[]): Promise<Map<string, string | null>> {
    const imgs = await this.imagesFor([...new Set(spotIds)], true);
    return new Map(spotIds.map((id) => [id, imgs.get(id)?.[0]?.url ?? null]));
  }

  private imageDto(r: ImageRow, url: string | null): SpotImage {
    return {
      id: r.id,
      kind: r.kind,
      position: r.position,
      status: r.status,
      url: r.status === 'READY' ? url : null,
      width: r.width,
      height: r.height,
    };
  }

  private async availabilityFor(spotId: string) {
    return this.db
      .select({ weekday: availabilityRules.weekday, startMinute: availabilityRules.startMinute, endMinute: availabilityRules.endMinute })
      .from(availabilityRules)
      .where(eq(availabilityRules.spotId, spotId))
      .orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startMinute));
  }

  publishIssues(spot: SpotRow, readyImages: number, availabilityCount: number): PublishIssue[] {
    const issues: PublishIssue[] = [];
    if (spot.title.trim().length < 5) issues.push('TITLE');
    if (spot.priceHourly == null && spot.priceDaily == null && spot.priceWeekly == null && spot.priceMonthly == null) issues.push('PRICE');
    if (readyImages < SPOT_MIN_IMAGES) issues.push('IMAGES');
    if (!spot.access24h && availabilityCount === 0) issues.push('AVAILABILITY');
    if (!spot.rightsConfirmedAt) issues.push('RIGHTS');
    if (spot.maxDurationMinutes < spot.minDurationMinutes) issues.push('DURATION');
    return issues;
  }

  private async toHostSpot(spot: SpotRow): Promise<HostSpot> {
    const [[address], pos, availability, imgs] = await Promise.all([
      this.db.select().from(addresses).where(eq(addresses.id, spot.addressId)),
      this.db.execute<{ lat: number; lng: number; alat: number; alng: number }>(sql`
        select ST_Y(location) as lat, ST_X(location) as lng, ST_Y(approx_location) as alat, ST_X(approx_location) as alng
        from parking_spots where id = ${spot.id}`),
      this.availabilityFor(spot.id),
      this.imagesFor([spot.id], false),
    ]);
    const list = imgs.get(spot.id) ?? [];
    const p = pos.rows[0]!;
    return {
      id: spot.id,
      status: spot.status,
      title: spot.title,
      description: spot.description,
      address: {
        street: address!.street,
        houseNumber: address!.houseNumber,
        postalCode: address!.postalCode,
        city: address!.city,
      },
      location: { lat: Number(p.lat), lng: Number(p.lng) },
      approxLocation: { lat: Number(p.alat), lng: Number(p.alng) },
      floor: spot.floor,
      spotNumber: spot.spotNumber,
      spotType: spot.spotType,
      isCovered: spot.isCovered,
      vehicleTypes: spot.vehicleTypes as HostSpot['vehicleTypes'],
      maxLengthCm: spot.maxLengthCm,
      maxWidthCm: spot.maxWidthCm,
      maxHeightCm: spot.maxHeightCm,
      amenities: spot.amenities as HostSpot['amenities'],
      hasEvCharging: spot.hasEvCharging,
      evConnector: (spot.evConnector as HostSpot['evConnector']) ?? null,
      evPowerKw: spot.evPowerKw === null ? null : Number(spot.evPowerKw),
      accessMethod: spot.accessMethod as HostSpot['accessMethod'],
      access24h: spot.access24h,
      accessInstructions: spot.accessInstructions,
      rules: spot.rules,
      prices: { hourly: spot.priceHourly, daily: spot.priceDaily, weekly: spot.priceWeekly, monthly: spot.priceMonthly },
      currency: spot.currency.trim() as HostSpot['currency'],
      minDurationMinutes: spot.minDurationMinutes,
      maxDurationMinutes: spot.maxDurationMinutes,
      leadTimeMinutes: spot.leadTimeMinutes,
      instantBook: spot.instantBook,
      cancellationPolicy: spot.cancellationPolicy,
      rightsConfirmed: !!spot.rightsConfirmedAt,
      availability,
      images: list,
      publishIssues: this.publishIssues(spot, list.filter((i) => i.status === 'READY').length, availability.length),
      publishedAt: spot.publishedAt?.toISOString() ?? null,
      updatedAt: spot.updatedAt.toISOString(),
    };
  }

  /** Feldwerte aus der API in Spalten übersetzen. */
  private columns(input: UpdateSpotInput): Partial<typeof parkingSpots.$inferInsert> {
    const c: Partial<typeof parkingSpots.$inferInsert> = {};
    const copy = <K extends keyof UpdateSpotInput & keyof typeof parkingSpots.$inferInsert>(k: K) => {
      if (input[k] !== undefined) (c as Record<string, unknown>)[k] = input[k];
    };
    (
      [
        'title', 'description', 'floor', 'spotNumber', 'spotType', 'isCovered', 'vehicleTypes', 'maxLengthCm', 'maxWidthCm',
        'maxHeightCm', 'amenities', 'hasEvCharging', 'evConnector', 'accessMethod', 'access24h', 'accessInstructions', 'rules',
        'minDurationMinutes', 'maxDurationMinutes', 'leadTimeMinutes', 'instantBook', 'cancellationPolicy',
      ] as const
    ).forEach((k) => copy(k));
    if (input.evPowerKw !== undefined) c.evPowerKw = input.evPowerKw === null ? null : input.evPowerKw.toFixed(1);
    if (input.prices) {
      c.priceHourly = input.prices.hourly;
      c.priceDaily = input.prices.daily;
      c.priceWeekly = input.prices.weekly;
      c.priceMonthly = input.prices.monthly;
    }
    if (input.rightsConfirmed !== undefined) c.rightsConfirmedAt = input.rightsConfirmed ? new Date() : null;
    if (input.hasEvCharging === false) {
      c.evConnector = null;
      c.evPowerKw = null;
    }
    return c;
  }

  // ─── Vermieter ─────────────────────────────────────────────────────────

  async hostFee(regionId: string | null = null): Promise<HostFee> {
    const rows = await this.db.execute<{ host_fee_bps: number; renter_fee_bps: number }>(sql`
      select host_fee_bps, renter_fee_bps from platform_fee_rules
      where (region_id is null or region_id = ${regionId}) and host_tier is null
        and valid_from <= now() and (valid_to is null or valid_to > now())
      order by (region_id is not null) desc, valid_from desc limit 1`);
    const r = rows.rows[0];
    return { hostFeeBps: r?.host_fee_bps ?? 1500, renterFeeBps: r?.renter_fee_bps ?? 0 };
  }

  async list(hostId: string): Promise<HostSpotListItem[]> {
    const spots = await this.db.select().from(parkingSpots).where(eq(parkingSpots.hostId, hostId)).orderBy(asc(parkingSpots.createdAt));
    if (!spots.length) return [];
    const ids = spots.map((s) => s.id);
    const [addrRows, imgs, avail] = await Promise.all([
      this.db.select().from(addresses).where(inArray(addresses.id, spots.map((s) => s.addressId))),
      this.imagesFor(ids, true),
      this.db
        .select({ spotId: availabilityRules.spotId, n: sql<number>`count(*)::int` })
        .from(availabilityRules)
        .where(inArray(availabilityRules.spotId, ids))
        .groupBy(availabilityRules.spotId),
    ]);
    const addr = new Map(addrRows.map((a) => [a.id, a]));
    const availCount = new Map(avail.map((a) => [a.spotId, a.n]));
    return spots.map((s) => {
      const a = addr.get(s.addressId)!;
      const list = imgs.get(s.id) ?? [];
      return {
        id: s.id,
        status: s.status,
        title: s.title,
        address: { street: a.street, houseNumber: a.houseNumber, postalCode: a.postalCode, city: a.city },
        prices: { hourly: s.priceHourly, daily: s.priceDaily, weekly: s.priceWeekly, monthly: s.priceMonthly },
        currency: s.currency.trim() as HostSpot['currency'],
        publishIssues: this.publishIssues(s, list.length, availCount.get(s.id) ?? 0),
        updatedAt: s.updatedAt.toISOString(),
        coverUrl: list[0]?.url ?? null,
        imageCount: list.length,
      };
    });
  }

  async get(hostId: string, spotId: string): Promise<HostSpot> {
    return this.toHostSpot(await this.own(hostId, spotId));
  }

  async create(hostId: string, input: CreateSpotInput): Promise<HostSpot> {
    const region = await this.regionFor(input.location);
    const approx = approximate(input.location);
    const id = await this.db.transaction(async (tx) => {
      const [address] = await tx
        .insert(addresses)
        .values({
          street: input.address.street,
          houseNumber: input.address.houseNumber,
          postalCode: input.address.postalCode,
          city: input.address.city,
          countryCode: 'CH',
          location: { x: input.location.lng, y: input.location.lat },
        })
        .returning({ id: addresses.id });
      const [spot] = await tx
        .insert(parkingSpots)
        .values({
          ...this.columns(input),
          hostId,
          regionId: region.id,
          addressId: address!.id,
          location: { x: input.location.lng, y: input.location.lat },
          approxLocation: { x: approx.lng, y: approx.lat },
          title: input.title?.trim() || `Parkplatz in ${input.address.city}`,
          spotType: input.spotType ?? 'OUTDOOR',
          currency: region.currency,
          status: 'DRAFT',
        })
        .returning({ id: parkingSpots.id });
      return spot!.id;
    });
    return this.get(hostId, id);
  }

  async update(hostId: string, spotId: string, input: UpdateSpotInput): Promise<HostSpot> {
    const spot = await this.own(hostId, spotId);
    if (spot.status === 'SUSPENDED') throw AppError.forbidden('Dieses Inserat ist gesperrt. Bitte kontaktiere den Support.');
    const min = input.minDurationMinutes ?? spot.minDurationMinutes;
    const max = input.maxDurationMinutes ?? spot.maxDurationMinutes;
    if (max < min) throw AppError.validation('Die Höchstdauer muss mindestens so lang sein wie die Mindestdauer');
    if (input.prices && spot.status !== 'DRAFT' && Object.values(input.prices).every((v) => v == null)) {
      throw AppError.conflict('Ein veröffentlichtes Inserat braucht mindestens einen Preis. Pausiere es oder gib einen Preis an.', {
        issues: ['PRICE'],
      });
    }
    await this.db.transaction(async (tx) => {
      const set = this.columns(input);
      if (input.location) {
        const pos = await tx.execute<{ lat: number; lng: number }>(sql`select ST_Y(location) as lat, ST_X(location) as lng from parking_spots where id = ${spotId}`);
        const old = pos.rows[0]!;
        set.location = { x: input.location.lng, y: input.location.lat };
        // Öffentliche Position nur neu würfeln, wenn der Platz wirklich woanders liegt
        if (distanceMeters({ lat: Number(old.lat), lng: Number(old.lng) }, input.location) > 50) {
          const a = approximate(input.location);
          set.approxLocation = { x: a.lng, y: a.lat };
          set.regionId = (await this.regionFor(input.location)).id;
        }
      }
      if (input.address || input.location) {
        await tx
          .update(addresses)
          .set({
            ...(input.address ?? {}),
            ...(input.location ? { location: { x: input.location.lng, y: input.location.lat } } : {}),
          })
          .where(eq(addresses.id, spot.addressId));
      }
      if (Object.keys(set).length) await tx.update(parkingSpots).set(set).where(eq(parkingSpots.id, spotId));
      const [after] = await tx.select().from(parkingSpots).where(eq(parkingSpots.id, spotId));
      if (after!.status === 'ACTIVE') {
        const [ready] = await tx.select({ n: sql<number>`count(*)::int` }).from(images).where(and(eq(images.spotId, spotId), eq(images.status, 'READY')));
        const [av] = await tx.select({ n: sql<number>`count(*)::int` }).from(availabilityRules).where(eq(availabilityRules.spotId, spotId));
        const issues = this.publishIssues(after!, ready!.n, av!.n);
        if (issues.length) {
          throw AppError.conflict('Diese Änderung ist bei einem aktiven Inserat nicht möglich. Pausiere es zuerst.', { issues });
        }
      }
    });
    return this.get(hostId, spotId);
  }

  async setAvailability(hostId: string, spotId: string, input: SpotAvailabilityInput): Promise<HostSpot> {
    const spot = await this.own(hostId, spotId);
    if (spot.status === 'ACTIVE' && !input.access24h && input.rules.length === 0) {
      throw AppError.conflict('Ein aktives Inserat braucht mindestens eine verfügbare Zeit');
    }
    await this.db.transaction(async (tx) => {
      await tx.update(parkingSpots).set({ access24h: input.access24h }).where(eq(parkingSpots.id, spotId));
      await tx.delete(availabilityRules).where(eq(availabilityRules.spotId, spotId));
      if (!input.access24h && input.rules.length) {
        await tx.insert(availabilityRules).values(input.rules.map((r) => ({ ...r, spotId })));
      }
    });
    return this.get(hostId, spotId);
  }

  async publish(hostId: string, spotId: string): Promise<HostSpot> {
    const current = await this.get(hostId, spotId);
    if (current.status === 'SUSPENDED') throw AppError.forbidden('Dieses Inserat ist gesperrt.');
    if (current.publishIssues.length) {
      throw new AppError(422, ERROR_CODES.VALIDATION_ERROR, 'Zum Veröffentlichen fehlt noch etwas', { issues: current.publishIssues });
    }
    await this.db
      .update(parkingSpots)
      .set({ status: 'ACTIVE', publishedAt: current.publishedAt ? undefined : new Date() })
      .where(eq(parkingSpots.id, spotId));
    return this.get(hostId, spotId);
  }

  async pause(hostId: string, spotId: string): Promise<HostSpot> {
    const spot = await this.own(hostId, spotId);
    if (spot.status !== 'ACTIVE') throw AppError.conflict('Nur aktive Inserate können pausiert werden');
    await this.db.update(parkingSpots).set({ status: 'PAUSED' }).where(eq(parkingSpots.id, spotId));
    return this.get(hostId, spotId);
  }

  async remove(hostId: string, spotId: string): Promise<void> {
    const spot = await this.own(hostId, spotId);
    const [b] = await this.db.select({ n: sql<number>`count(*)::int` }).from(bookings).where(eq(bookings.spotId, spotId));
    if (b!.n > 0) {
      throw AppError.conflict('Dieser Parkplatz hat Buchungen und kann nicht gelöscht werden. Pausiere ihn stattdessen.');
    }
    const keys = (await this.db.select({ k: images.storageKey }).from(images).where(eq(images.spotId, spotId))).map((r) => r.k);
    await this.db.transaction(async (tx) => {
      await tx.delete(parkingSpots).where(eq(parkingSpots.id, spotId));
      await tx.delete(addresses).where(eq(addresses.id, spot.addressId));
    });
    if (keys.length && this.storage) await this.storage.remove(keys).catch(() => undefined);
  }

  // ─── Fotos ─────────────────────────────────────────────────────────────

  async requestImageUpload(hostId: string, spotId: string, input: RequestImageUploadInput): Promise<ImageUploadTicket> {
    const storage = this.requireStorage();
    await this.own(hostId, spotId);
    const existing = await this.db
      .select({ id: images.id, position: images.position, status: images.status, createdAt: images.createdAt })
      .from(images)
      .where(eq(images.spotId, spotId));
    // Abgebrochene Uploads (älter als 1 Stunde) zählen nicht
    const active = existing.filter((i) => i.status === 'READY' || (i.status === 'PENDING_UPLOAD' && Date.now() - i.createdAt.getTime() < 3_600_000));
    if (active.length >= SPOT_MAX_IMAGES) throw AppError.conflict(`Höchstens ${SPOT_MAX_IMAGES} Fotos pro Parkplatz`);
    const ext = input.mimeType === 'image/png' ? 'png' : input.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const storageKey = `spots/${spotId}/${randomUUID()}.${ext}`;
    const upload = await storage.createUploadUrl(storageKey, input.mimeType);
    const [row] = await this.db
      .insert(images)
      .values({
        spotId,
        uploadedBy: hostId,
        storageKey,
        kind: input.kind,
        position: Math.max(-1, ...existing.map((i) => i.position)) + 1,
        width: input.width,
        height: input.height,
        bytes: input.bytes,
        mimeType: input.mimeType,
        status: 'PENDING_UPLOAD',
      })
      .returning();
    return { image: this.imageDto(row!, null), upload: { url: upload.url, method: 'PUT', headers: upload.headers } };
  }

  async completeImageUpload(hostId: string, spotId: string, imageId: string): Promise<SpotImage> {
    const storage = this.requireStorage();
    await this.own(hostId, spotId);
    const [img] = await this.db.select().from(images).where(and(eq(images.id, imageId), eq(images.spotId, spotId)));
    if (!img) throw AppError.notFound('Foto nicht gefunden');
    if (img.status === 'READY') return this.imageDto(img, (await this.signed([img.storageKey])).get(img.storageKey) ?? null);

    const info = await storage.stat(img.storageKey);
    if (!info) throw AppError.conflict('Das Foto ist noch nicht hochgeladen');
    const head = await storage.head(img.storageKey, 16);
    const sniffed = head ? sniffImageType(head) : null;
    const reject = async (message: string) => {
      await this.db.update(images).set({ status: 'REJECTED' }).where(eq(images.id, imageId));
      await storage.remove([img.storageKey]).catch(() => undefined);
      throw AppError.validation(message);
    };
    if (info.size <= 0 || info.size > IMAGE_MAX_BYTES) await reject('Das Foto ist zu gross (höchstens 10 MB)');
    if (!sniffed || !(IMAGE_MIME_TYPES as readonly string[]).includes(sniffed)) await reject('Nur JPEG-, PNG- oder WebP-Fotos sind erlaubt');

    const [row] = await this.db
      .update(images)
      .set({ status: 'READY', bytes: info.size, mimeType: sniffed })
      .where(eq(images.id, imageId))
      .returning();
    return this.imageDto(row!, (await this.signed([row!.storageKey])).get(row!.storageKey) ?? null);
  }

  async reorderImages(hostId: string, spotId: string, input: ReorderImagesInput): Promise<HostSpot> {
    await this.own(hostId, spotId);
    const rows = await this.db.select({ id: images.id }).from(images).where(eq(images.spotId, spotId));
    const known = new Set(rows.map((r) => r.id));
    if (input.items.some((i) => !known.has(i.id))) throw AppError.validation('Unbekanntes Foto in der Reihenfolge');
    await this.db.transaction(async (tx) => {
      for (const [idx, item] of input.items.entries()) {
        await tx.update(images).set({ position: idx, kind: item.kind }).where(eq(images.id, item.id));
      }
    });
    return this.get(hostId, spotId);
  }

  async deleteImage(hostId: string, spotId: string, imageId: string): Promise<HostSpot> {
    const spot = await this.own(hostId, spotId);
    const [img] = await this.db.select().from(images).where(and(eq(images.id, imageId), eq(images.spotId, spotId)));
    if (!img) throw AppError.notFound('Foto nicht gefunden');
    if (spot.status === 'ACTIVE' && img.status === 'READY') {
      const [ready] = await this.db.select({ n: sql<number>`count(*)::int` }).from(images).where(and(eq(images.spotId, spotId), eq(images.status, 'READY')));
      if (ready!.n <= SPOT_MIN_IMAGES) {
        throw AppError.conflict(`Ein aktives Inserat braucht mindestens ${SPOT_MIN_IMAGES} Fotos. Lade zuerst ein neues hoch oder pausiere es.`);
      }
    }
    await this.db.delete(images).where(eq(images.id, imageId));
    if (this.storage) await this.storage.remove([img.storageKey]).catch(() => undefined);
    // Reihenfolge lückenlos halten
    const rest = await this.db.select({ id: images.id }).from(images).where(eq(images.spotId, spotId)).orderBy(asc(images.position));
    for (const [idx, r] of rest.entries()) await this.db.update(images).set({ position: idx }).where(eq(images.id, r.id));
    return this.get(hostId, spotId);
  }

  // ─── Öffentlich ────────────────────────────────────────────────────────

  async detail(spotId: string, userId: string | null): Promise<SpotDetail> {
    const rows = await this.db.execute<{
      id: string;
      host_id: string;
      status: string;
      alat: number;
      alng: number;
      postal_code: string;
      city: string;
      first_name: string | null;
      is_favorite: boolean;
    }>(sql`
      select s.id, s.host_id, s.status, ST_Y(s.approx_location) as alat, ST_X(s.approx_location) as alng,
             a.postal_code, a.city, u.first_name,
             ${userId ? sql`exists (select 1 from favorites f where f.user_id = ${userId} and f.spot_id = s.id)` : sql`false`} as is_favorite
      from parking_spots s
      join addresses a on a.id = s.address_id
      join users u on u.id = s.host_id
      where s.id = ${spotId}`);
    const r = rows.rows[0];
    const isOwn = !!r && !!userId && r.host_id === userId;
    if (!r || (r.status !== 'ACTIVE' && !isOwn)) throw AppError.notFound('Parkplatz nicht gefunden');
    const [spot] = await this.db.select().from(parkingSpots).where(eq(parkingSpots.id, spotId));
    const [availability, imgs] = await Promise.all([this.availabilityFor(spotId), this.imagesFor([spotId], true)]);
    const s = spot!;
    return {
      id: s.id,
      kind: 'PRIVATE_MARKETPLACE_PARKING',
      title: s.title,
      description: s.description,
      area: `${r.postal_code} ${r.city}`,
      lat: Number(r.alat),
      lng: Number(r.alng),
      spotType: s.spotType,
      floor: s.floor,
      isCovered: s.isCovered,
      vehicleTypes: s.vehicleTypes as SpotDetail['vehicleTypes'],
      maxLengthCm: s.maxLengthCm,
      maxWidthCm: s.maxWidthCm,
      maxHeightCm: s.maxHeightCm,
      amenities: s.amenities as SpotDetail['amenities'],
      hasEvCharging: s.hasEvCharging,
      evConnector: (s.evConnector as SpotDetail['evConnector']) ?? null,
      evPowerKw: s.evPowerKw === null ? null : Number(s.evPowerKw),
      accessMethod: s.accessMethod as SpotDetail['accessMethod'],
      access24h: s.access24h,
      rules: s.rules,
      prices: { hourly: s.priceHourly, daily: s.priceDaily, weekly: s.priceWeekly, monthly: s.priceMonthly },
      currency: s.currency.trim() as SpotDetail['currency'],
      minDurationMinutes: s.minDurationMinutes,
      maxDurationMinutes: s.maxDurationMinutes,
      leadTimeMinutes: s.leadTimeMinutes,
      instantBook: s.instantBook,
      cancellationPolicy: s.cancellationPolicy,
      availability,
      images: imgs.get(spotId) ?? [],
      host: { firstName: r.first_name },
      rating: { avg: s.ratingAvg === null ? null : Number(s.ratingAvg), count: s.ratingCount },
      isFavorite: !!r.is_favorite,
      isOwn,
    };
  }
}
