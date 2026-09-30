import { describe, expect, it } from 'vitest';
import { formatMoney, splitPlatformFee } from './money';

describe('splitPlatformFee', () => {
  it('teilt CHF 30 bei 15 % korrekt', () => {
    expect(splitPlatformFee(3000, 1500)).toEqual({ platformFee: 450, hostPayout: 2550 });
  });

  it('verliert beim Runden keinen Rappen', () => {
    for (const gross of [1, 7, 333, 1999, 123457]) {
      const { platformFee, hostPayout } = splitPlatformFee(gross, 1250);
      expect(platformFee + hostPayout).toBe(gross);
    }
  });

  it('lehnt ungültige Werte ab', () => {
    expect(() => splitPlatformFee(10.5, 1500)).toThrow();
    expect(() => splitPlatformFee(100, 12_000)).toThrow();
  });
});

describe('formatMoney', () => {
  it('formatiert CHF', () => {
    expect(formatMoney({ amount: 2500, currency: 'CHF' })).toMatch(/CHF\s?25/);
    expect(formatMoney({ amount: 2550, currency: 'CHF' })).toMatch(/25\.50/);
  });
});
