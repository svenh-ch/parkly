import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { LOYALTY_TIERS, type CreateEventInput, type Loyalty, type LoyaltyTierInfo, type ParkEvent } from '@parking/shared';
import type { Database } from '../db/client';
import { events, loyaltyTiers, userLoyalty } from '../db/schema';
import { AppError } from '../lib/errors';

type Tier = (typeof LOYALTY_TIERS)[number];

const YEAR_MS = 365 * 24 * 3_600_000;
/** Buchungen zählen erst ab 1 Stunde und CHF 5, höchstens 5 pro Gegenüber. */
export const LOYALTY_RULES = { minMinutes: 60, minSubtotal: 500, maxPerCounterparty: 5 } as const;

const FALLBACK: LoyaltyTierInfo = { tier: 'BRONZE', minPoints: 0, renterFeeBps: 1000, hostFeeBps: 1500, earlyAccessHours: 0 };

/**
 * Treueprogramm: Punkte = abgeschlossene Buchungen der letzten 12 Monate (als Mieter und als Vermieter).
 * Nicht gezählt: eigene Plätze, stornierte Buchungen, unter 1 h oder unter CHF 5,
 * mehr als 5 Buchungen mit derselben Person. Eine erreichte Stufe gilt mindestens 12 Monate.
 */
export class LoyaltyService {
  private cache: { at: number; tiers: LoyaltyTierInfo[] } | null = null;

  constructor(private readonly db: Database) {}

  async tiers(): Promise<LoyaltyTierInfo[]> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.tiers;
    const rows = await this.db.select().from(loyaltyTiers).orderBy(asc(loyaltyTiers.rank));
    const tiers = rows.length
      ? rows.map((r) => ({ tier: r.tier as Tier, minPoints: r.minPoints, renterFeeBps: r.renterFeeBps, hostFeeBps: r.hostFeeBps, earlyAccessHours: r.earlyAccessHours }))
      : [FALLBACK];
    this.cache = { at: Date.now(), tiers };
    return tiers;
  }

  async info(tier: string): Promise<LoyaltyTierInfo> {
    const tiers = await this.tiers();
    return tiers.find((t) => t.tier === tier) ?? tiers[0] ?? FALLBACK;
  }

  private rank(tiers: LoyaltyTierInfo[], tier: string) {
    return tiers.findIndex((t) => t.tier === tier);
  }

  async points(userId: string, now = new Date()): Promise<number> {
    const res = await this.db.execute<{ points: number }>(sql`
      with q as (
        select case when b.renter_id = ${userId} then b.host_id else b.renter_id end as other
        from bookings b
        where b.status = 'COMPLETED'
          and b.completed_at > ${new Date(now.getTime() - YEAR_MS)}
          and b.renter_id <> b.host_id
          and (b.renter_id = ${userId} or b.host_id = ${userId})
          and extract(epoch from (b.end_at - b.start_at)) >= ${LOYALTY_RULES.minMinutes * 60}
          and b.subtotal >= ${LOYALTY_RULES.minSubtotal}
      )
      select coalesce(sum(least(n, ${LOYALTY_RULES.maxPerCounterparty})), 0)::int as points
      from (select other, count(*) as n from q group by other) x`);
    return Number(res.rows[0]?.points ?? 0);
  }

  /** Punkte neu zählen und Stufe festlegen (nach jeder abgeschlossenen Buchung). */
  async recompute(userId: string, now = new Date()): Promise<{ tier: Tier; points: number; heldUntil: Date | null }> {
    const [tiers, points, [existing]] = await Promise.all([
      this.tiers(),
      this.points(userId, now),
      this.db.select().from(userLoyalty).where(eq(userLoyalty.userId, userId)),
    ]);
    const computed = [...tiers].reverse().find((t) => points >= t.minPoints) ?? tiers[0]!;
    let tier = computed.tier as Tier;
    let heldUntil: Date | null = existing?.tierHeldUntil ?? null;
    const computedRank = this.rank(tiers, computed.tier);
    const storedRank = existing ? this.rank(tiers, existing.tier) : 0;
    const stillHeld = !!existing?.tierHeldUntil && existing.tierHeldUntil > now;

    if (stillHeld && storedRank > computedRank) {
      tier = existing!.tier as Tier; // höhere Stufe gilt noch bis heldUntil
    } else if (computedRank > 0) {
      // Stufe erreicht oder bestätigt: gilt 12 Monate ab jetzt
      heldUntil = new Date(now.getTime() + YEAR_MS);
    } else {
      heldUntil = null;
    }

    await this.db
      .insert(userLoyalty)
      .values({ userId, tier, points, tierHeldUntil: heldUntil })
      .onConflictDoUpdate({ target: userLoyalty.userId, set: { tier, points, tierHeldUntil: heldUntil, updatedAt: now } });
    return { tier, points, heldUntil };
  }

  /** Aktuelle Stufe mit Vorteilen (ohne Neuberechnung, ausser sie ist abgelaufen). */
  async current(userId: string | null, now = new Date()): Promise<LoyaltyTierInfo> {
    if (!userId) return this.info('BRONZE');
    const [row] = await this.db.select().from(userLoyalty).where(eq(userLoyalty.userId, userId));
    if (!row) return this.info('BRONZE');
    if (row.tier !== 'BRONZE' && row.tierHeldUntil && row.tierHeldUntil <= now) {
      return this.info((await this.recompute(userId, now)).tier);
    }
    return this.info(row.tier);
  }

  async summary(userId: string, now = new Date()): Promise<Loyalty> {
    const [state, tiers] = await Promise.all([this.recompute(userId, now), this.tiers()]);
    const idx = this.rank(tiers, state.tier);
    const next = tiers.slice(idx + 1).find((t) => t.minPoints > state.points) ?? null;
    return {
      tier: state.tier,
      points: state.points,
      heldUntil: state.heldUntil?.toISOString() ?? null,
      next,
      pointsToNext: next ? next.minPoints - state.points : 0,
      tiers,
    };
  }

  // ─── Events mit Vorkauf ──────────────────────────────────────────────

  /** Event im Umkreis, das mit dem Zeitraum überlappt (3 h vorher bis 1 h nachher). */
  async eventFor(p: { lat: number; lng: number }, start: Date, end: Date) {
    const res = await this.db.execute<{ id: string; name: string; public_open_at: Date }>(sql`
      select id, name, public_open_at from events
      where is_active
        and ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography, radius_meters)
        and tstzrange(starts_at - interval '3 hours', ends_at + interval '1 hour') && tstzrange(${start}, ${end})
      order by public_open_at desc limit 1`);
    const r = res.rows[0];
    return r ? { id: r.id, name: r.name, publicOpenAt: new Date(r.public_open_at) } : null;
  }

  accessAt(publicOpenAt: Date, tier: LoyaltyTierInfo): Date {
    return new Date(publicOpenAt.getTime() - tier.earlyAccessHours * 3_600_000);
  }

  async createEvent(input: CreateEventInput): Promise<ParkEvent> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    const publicOpenAt = new Date(input.publicOpenAt);
    if (endsAt <= startsAt) throw AppError.validation('Das Ende muss nach dem Beginn liegen');
    if (publicOpenAt > startsAt) throw AppError.validation('Die öffentliche Freigabe muss vor dem Event sein');
    const [row] = await this.db
      .insert(events)
      .values({ name: input.name, location: { x: input.lng, y: input.lat }, radiusMeters: input.radiusMeters, startsAt, endsAt, publicOpenAt })
      .returning();
    return this.eventDto(row!, null);
  }

  async upcoming(userId: string | null, now = new Date()): Promise<ParkEvent[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(and(eq(events.isActive, true), gt(events.endsAt, now)))
      .orderBy(asc(events.startsAt))
      .limit(50);
    const tier = userId ? await this.current(userId, now) : null;
    return rows.map((r) => this.eventDto(r, tier));
  }

  private eventDto(r: typeof events.$inferSelect, tier: LoyaltyTierInfo | null): ParkEvent {
    return {
      id: r.id,
      name: r.name,
      lat: r.location.y,
      lng: r.location.x,
      radiusMeters: r.radiusMeters,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      publicOpenAt: r.publicOpenAt.toISOString(),
      yourAccessAt: tier ? this.accessAt(r.publicOpenAt, tier).toISOString() : null,
    };
  }
}
