import { describe, expect, it } from 'vitest';
import { distanceMeters, formatDistance, normalizeBbox, zoomFromLongitudeDelta } from './geo';

describe('geo', () => {
  it('berechnet Distanzen (HB Zürich → Oerlikon ≈ 3.6 km)', () => {
    const hb = { lat: 47.378177, lng: 8.540212 };
    const oerlikon = { lat: 47.411522, lng: 8.544206 };
    expect(distanceMeters(hb, oerlikon)).toBeGreaterThan(3600);
    expect(distanceMeters(hb, oerlikon)).toBeLessThan(3800);
  });

  it('formatiert Distanzen', () => {
    expect(formatDistance(447)).toBe('450 m');
    expect(formatDistance(3)).toBe('10 m');
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(formatDistance(12_600)).toBe('13 km');
  });

  it('berechnet Zoomstufen', () => {
    expect(zoomFromLongitudeDelta(360)).toBe(0);
    expect(zoomFromLongitudeDelta(720)).toBe(0);
    expect(Math.round(zoomFromLongitudeDelta(0.05))).toBe(13);
  });

  it('normalisiert Weltausschnitte', () => {
    expect(normalizeBbox({ minLng: -250, minLat: -95, maxLng: 250, maxLat: 95 })).toEqual({
      minLng: -180,
      minLat: -90,
      maxLng: 180,
      maxLat: 90,
    });
  });
});
