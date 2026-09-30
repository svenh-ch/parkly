import type { CURRENCY_CODES } from './enums';

/**
 * Geld wird überall als Ganzzahl in der kleinsten Einheit (Rappen/Cent) geführt.
 * Nie Floats für Beträge verwenden.
 */

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface Money {
  amount: number; // kleinste Einheit, Integer
  currency: CurrencyCode;
}

export function assertMinorUnits(amount: number): void {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`Betrag muss ein Integer in der kleinsten Einheit sein, erhalten: ${amount}`);
  }
}

/** Kaufmännische Rundung auf 5 Rappen (Schweizer Rundung). */
export function roundToFiveRappen(amount: number): number {
  return Math.round(amount / 5) * 5;
}

/**
 * Teilt einen Bruttobetrag in Plattformgebühr und Vermieteranteil.
 * feeBps = Basispunkte (1500 = 15 %). Die Summe beider Teile ergibt immer exakt den Bruttobetrag.
 */
export function splitPlatformFee(gross: number, feeBps: number): { platformFee: number; hostPayout: number } {
  assertMinorUnits(gross);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new RangeError(`feeBps muss zwischen 0 und 10000 liegen, erhalten: ${feeBps}`);
  }
  const platformFee = Math.round((gross * feeBps) / 10_000);
  return { platformFee, hostPayout: gross - platformFee };
}

export function formatMoney(money: Money, locale = 'de-CH'): string {
  const hasFraction = money.amount % 100 !== 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(money.amount / 100);
}
