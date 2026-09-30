import { formatMoney, type MapItem, type Occupancy, type PriceTag, type PriceUnit } from '@parking/shared';
import { colors } from '@/ui';

const unitLabel: Record<PriceUnit, string> = { HOUR: 'Std.', DAY: 'Tag', WEEK: 'Woche', MONTH: 'Monat' };

/** "CHF 25 / Tag" */
export function priceLabel(price: PriceTag): string {
  return `${formatMoney({ amount: price.amount, currency: price.currency })} / ${unitLabel[price.unit]}`;
}

/** Kurzform für Karten-Pins: "CHF 25" */
export function pinPriceLabel(price: PriceTag): string {
  return formatMoney({ amount: price.amount, currency: price.currency });
}

export type OccupancyLevel = 'high' | 'low' | 'full' | 'closed' | 'unknown';

export function occupancyLevel(occ: Occupancy | null, capacity: number | null): OccupancyLevel {
  if (!occ || !occ.isLive) return 'unknown';
  if (occ.status === 'CLOSED') return 'closed';
  if (occ.freeSpaces === null || occ.status === 'UNKNOWN') return 'unknown';
  if (occ.freeSpaces === 0) return 'full';
  const ratio = capacity ? occ.freeSpaces / capacity : 1;
  return occ.freeSpaces < 10 || ratio < 0.1 ? 'low' : 'high';
}

export const occupancyColor: Record<OccupancyLevel, string> = {
  high: colors.occupancyHigh,
  low: colors.occupancyLow,
  full: colors.occupancyNone,
  closed: colors.inkTertiary,
  unknown: colors.inkTertiary,
};

export function occupancyText(occ: Occupancy | null, capacity: number | null): string {
  const level = occupancyLevel(occ, capacity);
  switch (level) {
    case 'closed':
      return 'Geschlossen';
    case 'full':
      return 'Besetzt';
    case 'unknown':
      return capacity ? `${capacity} Plätze · keine Live-Daten` : 'Keine Live-Daten';
    default:
      return `${occ!.freeSpaces} frei`;
  }
}

/** Zeit seit der letzten Messung: "gerade eben", "vor 4 Min." */
export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `vor ${hours} Std.` : 'vor über einem Tag';
}

export function kindLabel(item: Pick<MapItem, 'kind'> & { name?: string }): string {
  if (item.kind !== 'PUBLIC_PARKING') return 'Privater Parkplatz';
  return item.name && /^parkplatz\b/i.test(item.name) ? 'Öffentlicher Parkplatz' : 'Parkhaus';
}
