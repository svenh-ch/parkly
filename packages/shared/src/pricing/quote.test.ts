import { describe, expect, it } from 'vitest';
import { calculateQuote, headlinePrice, PricingError, type SpotPricing } from './quote';

// Beispiel aus der Produktspezifikation: Privatparkplatz Zürich Oerlikon
const oerlikon: SpotPricing = { hourly: 500, daily: 2500, weekly: 12000, monthly: 35000 };

describe('calculateQuote', () => {
  it('verrechnet Stunden', () => {
    expect(calculateQuote(oerlikon, 120).subtotal).toBe(1000);
  });

  it('verrechnet Viertelstunden anteilig', () => {
    const q = calculateQuote(oerlikon, 75);
    expect(q.lines).toEqual([{ unit: 'HOUR', quantity: 1.25, unitPrice: 500, amount: 625 }]);
    expect(q.subtotal).toBe(625);
  });

  it('nimmt den Tagespreis, sobald er günstiger ist', () => {
    // 6h = CHF 30 > 1 Tag = CHF 25
    const q = calculateQuote(oerlikon, 6 * 60);
    expect(q.subtotal).toBe(2500);
    expect(q.lines[0]?.unit).toBe('DAY');
  });

  it('kombiniert Tag + Stunden (26h)', () => {
    const q = calculateQuote(oerlikon, 26 * 60);
    expect(q.subtotal).toBe(3500);
    expect(q.lines.map((l) => l.unit)).toEqual(['DAY', 'HOUR']);
  });

  it('nimmt die Woche statt 5 Tagen', () => {
    expect(calculateQuote(oerlikon, 5 * 24 * 60).subtotal).toBe(12000);
  });

  it('nimmt den Monat für 30 Tage', () => {
    expect(calculateQuote(oerlikon, 30 * 24 * 60).subtotal).toBe(35000);
  });

  it('rundet auf 5 Rappen', () => {
    const q = calculateQuote({ hourly: 333, daily: null, weekly: null, monthly: null }, 15);
    expect(q.subtotal % 5).toBe(0);
  });

  it('rundet auf die nächste Einheit, wenn keine kleinere angeboten wird', () => {
    const monthlyOnly = { hourly: null, daily: null, weekly: null, monthly: 20000 };
    expect(calculateQuote(monthlyOnly, 60).subtotal).toBe(20000);
    expect(calculateQuote(monthlyOnly, 31 * 24 * 60).subtotal).toBe(40000);
  });

  it('findet nicht-gierige Kombinationen', () => {
    // 2 Wochen teurer als Monat: 20 Tage -> Monat (300) statt 2W+6T (2*140+6*25=430)
    const p = { hourly: null, daily: 2500, weekly: 14000, monthly: 30000 };
    expect(calculateQuote(p, 20 * 24 * 60).subtotal).toBe(30000);
  });

  it('lehnt ungültige Dauern ab', () => {
    expect(() => calculateQuote(oerlikon, 10)).toThrow(PricingError);
    expect(() => calculateQuote(oerlikon, 0)).toThrow(PricingError);
  });

  it('lehnt Parkplätze ohne Preise ab', () => {
    expect(() => calculateQuote({ hourly: null, daily: null, weekly: null, monthly: null }, 60)).toThrow(
      PricingError,
    );
  });
});

describe('headlinePrice', () => {
  it('liefert die kleinste angebotene Einheit', () => {
    expect(headlinePrice({ hourly: null, daily: 2500, weekly: null, monthly: 35000 })).toEqual({
      unit: 'DAY',
      amount: 2500,
    });
  });
});
