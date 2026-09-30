import { readFile } from 'node:fs/promises';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { auditLogs, dataSources, facilityOccupancy, facilityTariffs, parkingFacilities, regions } from '../db/schema';
import type { FacilityStatus, FacilityTariffsInput, PriceUnit } from '@parking/shared';
import { AppError } from '../lib/errors';
import { facilityKey, type PlsEntry } from '../adapters/parking-data/zuerich-pls';

/**
 * Import und Aktualisierung öffentlicher Parkhäuser (PUBLIC_PARKING).
 * Alle Operationen sind idempotent und können beliebig oft laufen.
 */

interface SeedFeature {
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { name: string; capacity?: number | null };
}

export const PLS_SOURCE_KEY = 'zh_pls';

/** Datei-Format für Regionen (apps/api/data/regions/*.json). Neue Stadt = neue Datei, kein Code. */
export interface RegionFile {
  region: { slug: string; name: string; center: [number, number]; bounds: [number, number, number, number] };
  sources: { key: string; name: string; license: string; attribution: string | null; url: string | null }[];
  facilities: {
    source: string;
    externalId: string;
    name: string;
    facilityType: 'GARAGE' | 'LOT';
    street: string | null;
    postalCode: string | null;
    city: string | null;
    lat: number;
    lng: number;
    capacity: number | null;
    openingHours: string | null;
    website: string | null;
    operator?: string | null;
    /** Schlüssel im Echtzeit-Feed der Region (falls vorhanden). */
    liveKey?: string | null;
    tariffs?: { label: string; amount: number; unit: PriceUnit; notes?: string | null }[];
    /** Stand und Quelle der Tarife */
    tariffsAsOf?: string | null;
    tariffsSourceUrl?: string | null;
    attributes?: Record<string, unknown>;
  }[];
}

export interface LiveEntry {
  key: string;
  freeSpaces: number | null;
  status: FacilityStatus;
  observedAt: Date;
}

export class FacilityService {
  constructor(private readonly db: Database) {}

  private async sourceId(key: string): Promise<string> {
    const [row] = await this.db.select({ id: dataSources.id }).from(dataSources).where(eq(dataSources.key, key));
    if (!row) throw new Error(`Datenquelle "${key}" fehlt. Bitte zuerst "pnpm db:seed" ausführen.`);
    return row.id;
  }

  private async regionId(slug: string): Promise<string> {
    const [row] = await this.db.select({ id: regions.id }).from(regions).where(eq(regions.slug, slug));
    if (!row) throw new Error(`Region "${slug}" fehlt. Bitte zuerst "pnpm db:seed" ausführen.`);
    return row.id;
  }

  /** Importiert die Standorte der Parkleitsystem-Parkhäuser aus einer GeoJSON-Datei. */
  async importPlsLocations(geojsonPath: string): Promise<{ upserted: number }> {
    const raw = JSON.parse(await readFile(geojsonPath, 'utf8')) as { features: SeedFeature[] };
    const sourceId = await this.sourceId(PLS_SOURCE_KEY);
    const regionId = await this.regionId('zuerich');

    let upserted = 0;
    for (const f of raw.features) {
      const [lng, lat] = f.geometry.coordinates;
      const name = f.properties.name.trim();
      const isLot = /^parkplatz\b/i.test(name);
      await this.db
        .insert(parkingFacilities)
        .values({
          regionId,
          sourceId,
          externalId: facilityKey(name),
          name,
          facilityType: isLot ? 'LOT' : 'GARAGE',
          city: 'Zürich',
          location: { x: lng, y: lat },
          capacity: f.properties.capacity ?? null,
          sourceAttributes: f.properties,
        })
        .onConflictDoUpdate({
          target: [parkingFacilities.sourceId, parkingFacilities.externalId],
          set: {
            name,
            location: { x: lng, y: lat },
            capacity: f.properties.capacity ?? null,
            isActive: true,
          },
        });
      upserted++;
    }
    return { upserted };
  }

  /**
   * Übernimmt die Echtzeit-Belegung aus dem PLS-Feed.
   * Parkhäuser ohne bekannten Standort werden gemeldet, aber nicht angelegt.
   */
  async applyPlsOccupancy(
    entries: PlsEntry[],
  ): Promise<{ updated: number; unknown: string[]; unknownEntries: PlsEntry[] }> {
    const sourceId = await this.sourceId(PLS_SOURCE_KEY);
    const known = await this.db
      .select({ id: parkingFacilities.id, externalId: parkingFacilities.externalId, street: parkingFacilities.street })
      .from(parkingFacilities)
      .where(eq(parkingFacilities.sourceId, sourceId));
    const byKey = new Map(known.map((k) => [k.externalId, k]));

    let updated = 0;
    const unknownEntries: PlsEntry[] = [];

    await this.db.transaction(async (tx) => {
      for (const e of entries) {
        const facility = byKey.get(facilityKey(e.name));
        if (!facility) {
          unknownEntries.push(e);
          continue;
        }
        await tx
          .insert(facilityOccupancy)
          .values({
            facilityId: facility.id,
            freeSpaces: e.freeSpaces,
            status: e.status,
            observedAt: e.observedAt,
          })
          .onConflictDoUpdate({
            target: facilityOccupancy.facilityId,
            set: { freeSpaces: e.freeSpaces, status: e.status, observedAt: e.observedAt },
          });

        if (!facility.street && (e.street || e.link)) {
          await tx
            .update(parkingFacilities)
            .set({ street: e.street ?? undefined, website: e.link ?? undefined })
            .where(and(eq(parkingFacilities.id, facility.id), sql`${parkingFacilities.street} is null`));
        }
        updated++;
      }
      await tx.update(dataSources).set({ lastSyncedAt: new Date() }).where(eq(dataSources.id, sourceId));
    });

    return { updated, unknown: unknownEntries.map((e) => e.name), unknownEntries };
  }

  /** Region, Datenquellen, Parkhäuser/Parkplätze und Tarife aus einer Regionsdatei (idempotent). */
  async importRegion(data: RegionFile): Promise<{ upserted: number; deactivated: number }> {
    return this.db.transaction(async (tx) => {
      const r = data.region;
      const [minLat, minLng, maxLat, maxLng] = r.bounds;
      const [region] = await tx
        .insert(regions)
        .values({
          slug: r.slug,
          name: r.name,
          countryCode: 'CH',
          currency: 'CHF',
          timezone: 'Europe/Zurich',
          center: { x: r.center[1], y: r.center[0] },
          minLat: minLat.toFixed(6),
          minLng: minLng.toFixed(6),
          maxLat: maxLat.toFixed(6),
          maxLng: maxLng.toFixed(6),
          isActive: true,
        })
        .onConflictDoUpdate({
          target: regions.slug,
          set: {
            name: r.name,
            center: { x: r.center[1], y: r.center[0] },
            minLat: minLat.toFixed(6),
            minLng: minLng.toFixed(6),
            maxLat: maxLat.toFixed(6),
            maxLng: maxLng.toFixed(6),
            isActive: true,
          },
        })
        .returning({ id: regions.id });

      const sourceIds = new Map<string, string>();
      for (const src of data.sources) {
        const [row] = await tx
          .insert(dataSources)
          .values(src)
          .onConflictDoUpdate({
            target: dataSources.key,
            set: { name: src.name, license: src.license, attribution: src.attribution, url: src.url },
          })
          .returning({ id: dataSources.id });
        sourceIds.set(src.key, row!.id);
      }

      let upserted = 0;
      const seen = new Set<string>();
      for (const f of data.facilities) {
        const sourceId = sourceIds.get(f.source);
        if (!sourceId) throw new Error(`Unbekannte Quelle "${f.source}" in Region ${r.slug}`);
        const values = {
          regionId: region!.id,
          sourceId,
          externalId: f.externalId,
          name: f.name,
          operator: f.operator ?? null,
          facilityType: f.facilityType,
          street: f.street,
          postalCode: f.postalCode,
          city: f.city,
          location: { x: f.lng, y: f.lat },
          capacity: f.capacity,
          openingHours: f.openingHours,
          website: f.website,
          isActive: true,
          sourceAttributes: { ...(f.attributes ?? {}), liveKey: f.liveKey ?? null },
        };
        const { regionId: _r, sourceId: _s, externalId: _e, ...update } = values;
        const [row] = await tx
          .insert(parkingFacilities)
          .values(values)
          .onConflictDoUpdate({ target: [parkingFacilities.sourceId, parkingFacilities.externalId], set: update })
          .returning({ id: parkingFacilities.id });
        seen.add(row!.id);
        await tx.delete(facilityTariffs).where(eq(facilityTariffs.facilityId, row!.id));
        if (f.tariffs?.length) {
          await tx.insert(facilityTariffs).values(
            f.tariffs.map((t, i) => ({
              facilityId: row!.id,
              label: t.label,
              amount: t.amount,
              unit: t.unit,
              notes: t.notes ?? null,
              currency: 'CHF',
              asOf: f.tariffsAsOf ?? null,
              sourceUrl: f.tariffsSourceUrl ?? null,
              position: i,
            })),
          );
        }
        upserted++;
      }

      // Einträge, die nicht mehr in der Datei stehen, ausblenden (nicht löschen: Bewertungen/Favoriten bleiben)
      const ids = [...sourceIds.values()];
      const stale = await tx
        .select({ id: parkingFacilities.id })
        .from(parkingFacilities)
        .where(and(inArray(parkingFacilities.sourceId, ids), eq(parkingFacilities.isActive, true)));
      const toDeactivate = stale.map((x) => x.id).filter((id) => !seen.has(id));
      if (toDeactivate.length) {
        await tx.update(parkingFacilities).set({ isActive: false }).where(inArray(parkingFacilities.id, toDeactivate));
      }
      return { upserted, deactivated: toDeactivate.length };
    });
  }

  /** Echtzeit-Belegung für eine Region übernehmen (Zuordnung über liveKey). */
  async applyLiveOccupancy(regionSlug: string, entries: LiveEntry[]): Promise<{ updated: number; unknown: string[] }> {
    const regionId = await this.regionId(regionSlug);
    const rows = await this.db
      .select({ id: parkingFacilities.id, liveKey: sql<string | null>`${parkingFacilities.sourceAttributes}->>'liveKey'` })
      .from(parkingFacilities)
      .where(and(eq(parkingFacilities.regionId, regionId), sql`${parkingFacilities.sourceAttributes}->>'liveKey' is not null`));
    const byKey = new Map(rows.map((r) => [r.liveKey!, r.id]));
    let updated = 0;
    const unknown: string[] = [];
    await this.db.transaction(async (tx) => {
      for (const e of entries) {
        const facilityId = byKey.get(e.key);
        if (!facilityId) {
          unknown.push(e.key);
          continue;
        }
        await tx
          .insert(facilityOccupancy)
          .values({ facilityId, freeSpaces: e.freeSpaces, status: e.status, observedAt: e.observedAt })
          .onConflictDoUpdate({
            target: facilityOccupancy.facilityId,
            set: { freeSpaces: e.freeSpaces, status: e.status, observedAt: e.observedAt },
          });
        updated++;
      }
    });
    return { updated, unknown };
  }

  /** Tarife eines Parkhauses ersetzen (Admin), immer mit "Stand vom" und Quelle. */
  async setTariffs(facilityId: string, input: FacilityTariffsInput, actorId: string): Promise<void> {
    const [f] = await this.db.select({ id: parkingFacilities.id }).from(parkingFacilities).where(eq(parkingFacilities.id, facilityId));
    if (!f) throw AppError.notFound('Parkhaus nicht gefunden');
    await this.db.transaction(async (tx) => {
      await tx.delete(facilityTariffs).where(eq(facilityTariffs.facilityId, facilityId));
      if (input.items.length) {
        await tx.insert(facilityTariffs).values(
          input.items.map((t, i) => ({
            facilityId,
            label: t.label,
            amount: t.amount,
            unit: t.unit,
            notes: t.notes ?? null,
            currency: 'CHF',
            asOf: input.asOf,
            sourceUrl: input.sourceUrl,
            position: i,
          })),
        );
      }
      await tx.update(parkingFacilities).set({ verifiedAt: new Date() }).where(eq(parkingFacilities.id, facilityId));
      await tx.insert(auditLogs).values({
        actorId,
        action: 'facility.tariffs.update',
        entityType: 'facility',
        entityId: facilityId,
        metadata: { asOf: input.asOf, count: input.items.length },
      });
    });
  }

  /** Grenzen einer Region (z. B. für Plausibilitätsprüfung beim Geocoding). */
  async regionBounds(slug: string) {
    const [r] = await this.db
      .select({ minLat: regions.minLat, minLng: regions.minLng, maxLat: regions.maxLat, maxLng: regions.maxLng })
      .from(regions)
      .where(eq(regions.slug, slug));
    if (!r) return undefined;
    return { minLat: Number(r.minLat), minLng: Number(r.minLng), maxLat: Number(r.maxLat), maxLng: Number(r.maxLng) };
  }

  /**
   * Legt ein Parkhaus an, das im PLS-Feed neu aufgetaucht ist und dessen Standort per
   * Geocoding ermittelt wurde. Beim nächsten Sync erhält es automatisch die Belegung.
   */
  async createFromPls(entry: PlsEntry, position: { lat: number; lng: number; label: string }): Promise<void> {
    const sourceId = await this.sourceId(PLS_SOURCE_KEY);
    const regionId = await this.regionId('zuerich');
    await this.db
      .insert(parkingFacilities)
      .values({
        regionId,
        sourceId,
        externalId: facilityKey(entry.name),
        name: entry.name,
        facilityType: /^parkplatz\b/i.test(entry.name) ? 'LOT' : 'GARAGE',
        street: entry.street,
        city: 'Zürich',
        website: entry.link,
        location: { x: position.lng, y: position.lat },
        sourceAttributes: { pid: entry.pid, geocoded: { provider: 'swisstopo', label: position.label } },
      })
      .onConflictDoNothing({ target: [parkingFacilities.sourceId, parkingFacilities.externalId] });
  }
}
