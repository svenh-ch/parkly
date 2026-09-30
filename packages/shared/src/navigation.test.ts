import { describe, expect, it } from 'vitest';
import {
  NavigationTracker,
  bearingDegrees,
  cameraForSpeed,
  dueAnnouncement,
  formatArrival,
  formatDuration,
  formatManeuverDistance,
  maneuverText,
  spokenInstruction,
} from './navigation';
import type { Route } from './schemas/route';

// L-förmige Route: 1 km nach Osten, dann 1 km nach Norden (Zug)
const near = (v: number, target: number, tol = 25) => expect(Math.abs(v - target)).toBeLessThan(tol);
const LAT = 47.17;
const LNG = 8.5;
const dLng = 1000 / (110_574 * Math.cos((LAT * Math.PI) / 180));
const dLat = 1000 / 110_574;
const coords: [number, number][] = [];
for (let i = 0; i <= 10; i++) coords.push([LAT, LNG + (dLng * i) / 10]);
for (let i = 1; i <= 10; i++) coords.push([LAT + (dLat * i) / 10, LNG + dLng]);

const route: Route = {
  provider: 'test',
  attribution: '',
  distanceMeters: 2000,
  durationSeconds: 240,
  coordinates: coords,
  steps: [
    { type: 'DEPART', instruction: '', streetName: 'Baarerstrasse', exitNumber: null, distanceMeters: 1000, durationSeconds: 120, startIndex: 0 },
    { type: 'LEFT', instruction: '', streetName: 'Seestrasse', exitNumber: null, distanceMeters: 1000, durationSeconds: 120, startIndex: 10 },
    { type: 'ARRIVE', instruction: '', streetName: null, exitNumber: null, distanceMeters: 0, durationSeconds: 0, startIndex: 20 },
  ],
};

describe('NavigationTracker', () => {
  it('rastet ein und berechnet Rest und nächstes Manöver', () => {
    const t = new NavigationTracker(route);
    const s = t.update({ lat: LAT + 0.00005, lng: LNG + dLng * 0.3, accuracy: 5 });
    expect(s.offRouteMeters).toBeGreaterThan(4);
    expect(s.offRouteMeters).toBeLessThan(7);
    near(s.alongMeters, 300);
    near(s.remainingMeters, 1700);
    expect(s.maneuver.type).toBe('LEFT');
    near(s.distanceToManeuver, 700);
    expect(s.remainingSeconds).toBeGreaterThan(195);
    expect(s.remainingSeconds).toBeLessThan(210);
    expect(s.bearing).toBeCloseTo(90, 0);
    expect(s.offRoute).toBe(false);
    expect(s.arrived).toBe(false);
  });

  it('wechselt nach dem Abbiegen auf das Ziel', () => {
    const t = new NavigationTracker(route);
    const s = t.update({ lat: LAT + dLat * 0.5, lng: LNG + dLng });
    expect(s.maneuver.type).toBe('ARRIVE');
    near(s.distanceToManeuver, 500);
    expect(s.bearing).toBeCloseTo(0, 0);
  });

  it('erkennt Abweichung erst nach mehreren Positionen', () => {
    const t = new NavigationTracker(route);
    const off = { lat: LAT - 0.002, lng: LNG + dLng * 0.5, accuracy: 5 }; // ~220 m südlich
    expect(t.update(off).offRoute).toBe(false);
    expect(t.update(off).offRoute).toBe(false);
    expect(t.update(off).offRoute).toBe(true);
    // zurück auf der Route setzt zurück
    expect(t.update({ lat: LAT, lng: LNG + dLng * 0.6 }).offRoute).toBe(false);
  });

  it('erkennt die Ankunft', () => {
    const t = new NavigationTracker(route);
    const s = t.update({ lat: LAT + dLat * 0.99, lng: LNG + dLng });
    expect(s.arrived).toBe(true);
    expect(s.offRoute).toBe(false);
  });

  it('springt durch GPS-Rauschen nicht zurück', () => {
    const t = new NavigationTracker(route);
    t.update({ lat: LAT, lng: LNG + dLng * 0.5 });
    const s = t.update({ lat: LAT, lng: LNG + dLng * 0.495 });
    near(s.alongMeters, 500);
  });

  it('nutzt den GPS-Kurs bei Fahrt abseits der Linie', () => {
    const t = new NavigationTracker(route);
    const s = t.update({ lat: LAT + 0.0003, lng: LNG + dLng * 0.5, speed: 10, heading: 45 });
    expect(s.bearing).toBe(45);
  });
});

describe('Texte und Formatierung', () => {
  it('baut Manöver- und Sprachtexte', () => {
    expect(maneuverText({ type: 'ROUNDABOUT', exitNumber: 2 })).toBe('Im Kreisel die 2. Ausfahrt nehmen');
    expect(spokenInstruction(route.steps[1]!, 300)).toBe('In 300 Metern links abbiegen, Seestrasse');
    expect(spokenInstruction(route.steps[1]!, null)).toBe('Jetzt links abbiegen, Seestrasse');
    expect(spokenInstruction(route.steps[2]!, 10)).toBe('Du hast dein Ziel erreicht');
    expect(formatManeuverDistance(287)).toBe('275 m');
    expect(formatManeuverDistance(1234)).toBe('1.2 km');
    expect(formatDuration(30)).toBe('1 Min.');
    expect(formatDuration(3900)).toBe('1 Std. 5 Min.');
    expect(formatArrival(600, new Date(2026, 0, 1, 9, 55))).toBe('10:05');
    expect(bearingDegrees({ lat: 47, lng: 8 }, { lat: 47, lng: 8.1 })).toBeCloseTo(90, 0);
    expect(cameraForSpeed(30).zoom).toBeLessThan(cameraForSpeed(3).zoom);
  });

  it('kündigt jedes Manöver höchstens zweimal an', () => {
    const announced = new Set<string>();
    const m = { maneuverIndex: 1, maneuver: route.steps[1]! };
    expect(dueAnnouncement({ ...m, distanceToManeuver: 600 }, 10, announced)).toBeNull();
    expect(dueAnnouncement({ ...m, distanceToManeuver: 240 }, 10, announced)).toMatch(/^In 250 Metern/);
    expect(dueAnnouncement({ ...m, distanceToManeuver: 200 }, 10, announced)).toBeNull();
    expect(dueAnnouncement({ ...m, distanceToManeuver: 30 }, 10, announced)).toMatch(/^Jetzt/);
    expect(dueAnnouncement({ ...m, distanceToManeuver: 10 }, 10, announced)).toBeNull();
  });
});

describe('pointAlong', () => {
  it('interpoliert entlang der Route', async () => {
    const { prepareRoute, pointAlong } = await import('./navigation');
    const p = prepareRoute(route);
    const a = pointAlong(p, 1500);
    expect(a.lng).toBeCloseTo(LNG + dLng, 5);
    expect(a.bearing).toBeCloseTo(0, 0);
    expect(pointAlong(p, 99999).lat).toBeCloseTo(LAT + dLat, 6);
  });
});
