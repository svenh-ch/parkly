import { roundToFiveRappen } from '../money';
import type { PriceUnit } from '../enums';

/**
 * Preis-Engine für Marketplace-Parkplätze.
 *
 * Läuft identisch auf Client (Live-Vorschau) und Server (verbindlicher Preis).
 * Verbindlich ist ausschliesslich das Ergebnis auf dem Server.
 *
 * Regeln:
 *  - Buchungen erfolgen in 15-Minuten-Schritten (BOOKING_STEP_MINUTES).
 *  - Ein Monat entspricht 30 Tagen, eine Woche 7 Tagen.
 *  - Der Stundenpreis wird pro angefangener Viertelstunde anteilig verrechnet.
 *  - Es wird immer die für den Mieter günstigste Kombination der angebotenen Einheiten gewählt
 *    (z. B. 26 h = 1 Tag + 2 h oder 2 Tage, je nachdem, was günstiger ist).
 *  - Das Total wird auf 5 Rappen gerundet.
 */

export const BOOKING_STEP_MINUTES = 15;

export const UNIT_MINUTES: Record<PriceUnit, number> = {
  HOUR: 60,
  DAY: 60 * 24,
  WEEK: 60 * 24 * 7,
  MONTH: 60 * 24 * 30,
};

/** Preise in Rappen; null = Einheit wird nicht angeboten. */
export interface SpotPricing {
  hourly: number | null;
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
}

export interface QuoteLine {
  unit: PriceUnit;
  /** Menge in Einheiten; bei HOUR in Viertelstunden-Genauigkeit (z. B. 1.25). */
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface Quote {
  durationMinutes: number;
  lines: QuoteLine[];
  subtotal: number;
}

export class PricingError extends Error {
  constructor(
    public readonly code: 'NO_PRICES' | 'INVALID_DURATION' | 'INVALID_PRICE',
    message: string,
  ) {
    super(message);
    this.name = 'PricingError';
  }
}

const UNIT_ORDER: PriceUnit[] = ['MONTH', 'WEEK', 'DAY', 'HOUR'];

function priceFor(pricing: SpotPricing, unit: PriceUnit): number | null {
  switch (unit) {
    case 'HOUR':
      return pricing.hourly;
    case 'DAY':
      return pricing.daily;
    case 'WEEK':
      return pricing.weekly;
    case 'MONTH':
      return pricing.monthly;
  }
}

interface Level {
  unit: PriceUnit;
  minutes: number;
  price: number;
}

interface Solution {
  cost: number;
  counts: Map<PriceUnit, number>; // HOUR in Viertelstunden, sonst ganze Einheiten
}

export function durationMinutes(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

export function calculateQuote(pricing: SpotPricing, minutes: number): Quote {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes % BOOKING_STEP_MINUTES !== 0) {
    throw new PricingError(
      'INVALID_DURATION',
      `Dauer muss ein positives Vielfaches von ${BOOKING_STEP_MINUTES} Minuten sein`,
    );
  }

  const levels: Level[] = [];
  for (const unit of UNIT_ORDER) {
    const price = priceFor(pricing, unit);
    if (price === null) continue;
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new PricingError('INVALID_PRICE', `Ungültiger Preis für ${unit}`);
    }
    levels.push({ unit, minutes: UNIT_MINUTES[unit], price });
  }
  if (levels.length === 0) {
    throw new PricingError('NO_PRICES', 'Für diesen Parkplatz sind keine Preise hinterlegt');
  }

  const memo = new Map<string, Solution>();

  // Minimale Kosten, um `remaining` Minuten mit den Stufen ab Index i abzudecken.
  const solve = (remaining: number, i: number): Solution => {
    if (remaining <= 0) return { cost: 0, counts: new Map() };
    const key = `${remaining}:${i}`;
    const cached = memo.get(key);
    if (cached) return cached;

    const level = levels[i]!;
    const isLast = i === levels.length - 1;
    let best: Solution | null = null;

    if (level.unit === 'HOUR') {
      // Anteilig pro Viertelstunde; deckt jeden Rest exakt ab.
      const quarters = Math.ceil(remaining / BOOKING_STEP_MINUTES);
      best = { cost: (level.price * quarters) / 4, counts: new Map([['HOUR', quarters]]) };
    } else {
      const maxCount = Math.ceil(remaining / level.minutes);
      const minCount = isLast ? maxCount : 0; // letzte Stufe muss alles abdecken
      for (let k = minCount; k <= maxCount; k++) {
        const rest = solve(remaining - k * level.minutes, i + 1);
        const cost = k * level.price + rest.cost;
        if (best === null || cost < best.cost) {
          const counts = new Map(rest.counts);
          if (k > 0) counts.set(level.unit, k);
          best = { cost, counts };
        }
      }
    }

    memo.set(key, best!);
    return best!;
  };

  const solution = solve(minutes, 0);

  const lines: QuoteLine[] = [];
  for (const level of levels) {
    const count = solution.counts.get(level.unit);
    if (!count) continue;
    if (level.unit === 'HOUR') {
      lines.push({
        unit: 'HOUR',
        quantity: count / 4,
        unitPrice: level.price,
        amount: Math.round((level.price * count) / 4),
      });
    } else {
      lines.push({ unit: level.unit, quantity: count, unitPrice: level.price, amount: count * level.price });
    }
  }

  const raw = lines.reduce((sum, l) => sum + l.amount, 0);
  return { durationMinutes: minutes, lines, subtotal: roundToFiveRappen(raw) };
}

/** Günstigster "ab"-Preis für Karten-Pins und Cards, z. B. "CHF 25 / Tag". */
export function headlinePrice(pricing: SpotPricing): { unit: PriceUnit; amount: number } | null {
  const order: PriceUnit[] = ['HOUR', 'DAY', 'WEEK', 'MONTH'];
  for (const unit of order) {
    const amount = priceFor(pricing, unit);
    if (amount !== null) return { unit, amount };
  }
  return null;
}
