import { distanceMeters } from './geo';
import type { ManeuverType, Route, RouteStep } from './schemas/route';

/**
 * Navigations-Engine: reine Funktionen ohne UI, identisch testbar auf Server und Client.
 * Sie rastet die GPS-Position auf die Route ein und berechnet Restdistanz, Restzeit,
 * nächstes Manöver, Abweichung (-> Neuberechnung) und Ankunft.
 */

export interface Fix {
  lat: number;
  lng: number;
  /** Genauigkeit in Metern (optional). */
  accuracy?: number | null;
  /** Geschwindigkeit in m/s (optional, negativ = unbekannt). */
  speed?: number | null;
  /** Fahrtrichtung in Grad (0 = Nord), negativ = unbekannt. */
  heading?: number | null;
}

export interface NavSnapshot {
  /** Auf die Route eingerastete Position. */
  snapped: { lat: number; lng: number };
  /** Richtung für Auto-Icon und Kamera (Grad). */
  bearing: number;
  alongMeters: number;
  /** Index des Routenabschnitts, auf dem wir fahren (für die verbleibende Linie). */
  segmentIndex: number;
  remainingMeters: number;
  remainingSeconds: number;
  /** Aktueller Schritt (wir fahren gerade auf diesem Abschnitt). */
  stepIndex: number;
  /** Nächstes Manöver vor uns (Index in route.steps). */
  maneuverIndex: number;
  maneuver: RouteStep;
  distanceToManeuver: number;
  /** Abstand der GPS-Position zur Route. */
  offRouteMeters: number;
  /** Mehrere Positionen hintereinander neben der Route -> neu berechnen. */
  offRoute: boolean;
  arrived: boolean;
}

const M_PER_DEG_LAT = 110_574;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function bearingDegrees(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const pt = (c: [number, number]) => ({ lat: c[0], lng: c[1] });

export interface PreparedRoute {
  route: Route;
  /** Kumulierte Meter bis zu jedem Stützpunkt. */
  cum: number[];
  length: number;
  /** Meter entlang der Route, an denen Schritt i beginnt. */
  stepStart: number[];
}

export function prepareRoute(route: Route): PreparedRoute {
  const cum = [0];
  for (let i = 1; i < route.coordinates.length; i++) {
    cum.push(cum[i - 1]! + distanceMeters(pt(route.coordinates[i - 1]!), pt(route.coordinates[i]!)));
  }
  const length = cum[cum.length - 1]!;
  const last = route.coordinates.length - 1;
  const stepStart = route.steps.map((s) => cum[Math.min(s.startIndex, last)]!);
  return { route, cum, length, stepStart };
}

interface Projection {
  along: number;
  distance: number;
  lat: number;
  lng: number;
  segment: number;
}

/** Nächster Punkt auf der Route; bevorzugt Stellen, die nicht hinter der letzten Position liegen. */
export function projectOnRoute(p: PreparedRoute, fix: { lat: number; lng: number }, previousAlong = -1): Projection {
  const coords = p.route.coordinates;
  const cosLat = Math.cos(toRad(fix.lat));
  const mx = M_PER_DEG_LAT * cosLat;
  let best: Projection | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    // Lokale ebene Projektion (Meter) um die aktuelle Position
    const ax = (a[1] - fix.lng) * mx;
    const ay = (a[0] - fix.lat) * M_PER_DEG_LAT;
    const bx = (b[1] - fix.lng) * mx;
    const by = (b[0] - fix.lat) * M_PER_DEG_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const distance = Math.hypot(px, py);
    const along = p.cum[i]! + t * (p.cum[i + 1]! - p.cum[i]!);
    // Rückwärtssprünge (z. B. Gegenfahrbahn derselben Strasse) stark bestrafen
    const score = distance + (previousAlong >= 0 && along < previousAlong - 30 ? 500 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = {
        along,
        distance,
        lat: a[0] + t * (b[0] - a[0]),
        lng: a[1] + t * (b[1] - a[1]),
        segment: i,
      };
    }
  }
  return best!;
}

function stepIndexAt(p: PreparedRoute, along: number): number {
  let idx = 0;
  for (let i = 0; i < p.stepStart.length; i++) {
    if (p.stepStart[i]! <= along + 0.5 && p.route.steps[i]!.type !== 'ARRIVE') idx = i;
  }
  return idx;
}

function remainingSeconds(p: PreparedRoute, along: number, stepIndex: number): number {
  const steps = p.route.steps;
  const start = p.stepStart[stepIndex]!;
  const end = stepIndex + 1 < steps.length ? p.stepStart[stepIndex + 1]! : p.length;
  const span = Math.max(1, end - start);
  const doneFraction = Math.max(0, Math.min(1, (along - start) / span));
  let total = steps[stepIndex]!.durationSeconds * (1 - doneFraction);
  for (let i = stepIndex + 1; i < steps.length; i++) total += steps[i]!.durationSeconds;
  // Anbieter-Zeit auf die tatsächliche Restdistanz skalieren, falls Schritte keine Zeiten liefern
  if (total === 0 && p.route.durationSeconds > 0) {
    total = p.route.durationSeconds * Math.max(0, (p.length - along) / Math.max(1, p.length));
  }
  return total;
}

export interface TrackerOptions {
  /** Grundschwelle für "neben der Route" in Metern. */
  offRouteThreshold?: number;
  /** So viele Positionen hintereinander neben der Route, bevor neu berechnet wird. */
  offRouteFixes?: number;
  arrivalRadius?: number;
}

/**
 * Zustandsbehafteter Tracker für eine laufende Navigation. Pro GPS-Position `update` aufrufen.
 */
export class NavigationTracker {
  readonly prepared: PreparedRoute;
  private along = -1;
  private offCount = 0;
  private readonly opts: Required<TrackerOptions>;

  constructor(route: Route, opts: TrackerOptions = {}) {
    this.prepared = prepareRoute(route);
    this.opts = { offRouteThreshold: 40, offRouteFixes: 3, arrivalRadius: 30, ...opts };
  }

  get destination() {
    const c = this.prepared.route.coordinates;
    return pt(c[c.length - 1]!);
  }

  update(fix: Fix): NavSnapshot {
    const p = this.prepared;
    const proj = projectOnRoute(p, fix, this.along);
    // Nicht rückwärts springen durch GPS-Rauschen
    const along = this.along >= 0 && proj.along < this.along && this.along - proj.along < 15 ? this.along : proj.along;
    this.along = along;

    const accuracy = Math.min(Math.max(fix.accuracy ?? 10, 0), 60);
    const threshold = this.opts.offRouteThreshold + accuracy;
    this.offCount = proj.distance > threshold ? this.offCount + 1 : 0;

    const stepIndex = stepIndexAt(p, along);
    const maneuverIndex = Math.min(stepIndex + 1, p.route.steps.length - 1);
    const maneuverAt = maneuverIndex === stepIndex ? p.length : p.stepStart[maneuverIndex]!;
    const remainingMeters = Math.max(0, p.length - along);

    const seg = p.route.coordinates;
    const segBearing = bearingDegrees(pt(seg[proj.segment]!), pt(seg[Math.min(proj.segment + 1, seg.length - 1)]!));
    const hasCourse = (fix.speed ?? -1) > 2 && (fix.heading ?? -1) >= 0;
    const bearing = hasCourse && proj.distance > 15 ? fix.heading! : segBearing;

    const arrived =
      (remainingMeters < this.opts.arrivalRadius && proj.distance < 60) ||
      distanceMeters(fix, this.destination) < this.opts.arrivalRadius;

    return {
      snapped: proj.distance > threshold ? { lat: fix.lat, lng: fix.lng } : { lat: proj.lat, lng: proj.lng },
      bearing,
      alongMeters: along,
      segmentIndex: proj.segment,
      remainingMeters,
      remainingSeconds: Math.round(remainingSeconds(p, along, stepIndex)),
      stepIndex,
      maneuverIndex,
      maneuver: p.route.steps[maneuverIndex]!,
      distanceToManeuver: Math.max(0, maneuverAt - along),
      offRouteMeters: proj.distance,
      offRoute: !arrived && this.offCount >= this.opts.offRouteFixes,
      arrived,
    };
  }
}

// ─── Texte ────────────────────────────────────────────────────────────────

const VERBS: Record<ManeuverType, string> = {
  DEPART: 'Losfahren',
  STRAIGHT: 'Geradeaus weiter',
  SLIGHT_LEFT: 'Leicht links halten',
  LEFT: 'Links abbiegen',
  SHARP_LEFT: 'Scharf links abbiegen',
  SLIGHT_RIGHT: 'Leicht rechts halten',
  RIGHT: 'Rechts abbiegen',
  SHARP_RIGHT: 'Scharf rechts abbiegen',
  KEEP_LEFT: 'Links halten',
  KEEP_RIGHT: 'Rechts halten',
  UTURN: 'Wenden',
  ROUNDABOUT: 'In den Kreisel fahren',
  EXIT_ROUNDABOUT: 'Kreisel verlassen',
  MERGE: 'Einfädeln',
  RAMP: 'Ausfahrt nehmen',
  ARRIVE: 'Ziel erreicht',
};

/** Kurzer Anweisungstext, z. B. "Rechts abbiegen" oder "Im Kreisel die 2. Ausfahrt nehmen". */
export function maneuverText(step: Pick<RouteStep, 'type' | 'exitNumber'>): string {
  if (step.type === 'ROUNDABOUT' && step.exitNumber) return `Im Kreisel die ${step.exitNumber}. Ausfahrt nehmen`;
  return VERBS[step.type];
}

/** "300 m", "1,2 km"; nah am Manöver in groben Schritten, damit die Zahl nicht flackert. */
export function formatManeuverDistance(meters: number): string {
  if (meters < 1000) {
    const step = meters < 100 ? 10 : meters < 300 ? 25 : 50;
    return `${Math.max(10, Math.round(meters / step) * step)} m`;
  }
  // Schweizer Schreibweise mit Punkt, wie formatDistance (de-CH)
  return `${Math.round(meters / 100) / 10} km`;
}

function spokenDistance(meters: number): string {
  if (meters < 1000) {
    const rounded = meters < 300 ? Math.round(meters / 50) * 50 : Math.round(meters / 100) * 100;
    return `${Math.max(50, rounded)} Metern`;
  }
  const km = Math.round(meters / 100) / 10;
  return km === 1 ? 'einem Kilometer' : `${String(km).replace('.', ',')} Kilometern`;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Sprachansage, z. B. "In 300 Metern rechts abbiegen, Seestrasse". */
export function spokenInstruction(step: RouteStep, distance: number | null): string {
  if (step.type === 'ARRIVE') {
    return distance && distance > 40 ? `In ${spokenDistance(distance)} erreichst du dein Ziel` : 'Du hast dein Ziel erreicht';
  }
  const text = maneuverText(step);
  const street = step.streetName ? `, ${step.streetName}` : '';
  if (distance === null || distance < 40) return `Jetzt ${lowerFirst(text)}${street}`;
  return `In ${spokenDistance(distance)} ${lowerFirst(text)}${street}`;
}

/**
 * Entscheidet, ob jetzt eine Ansage fällig ist. Pro Manöver höchstens eine Vorankündigung
 * und eine "Jetzt"-Ansage. `announced` wird vom Aufrufer gehalten.
 */
export function dueAnnouncement(
  s: Pick<NavSnapshot, 'maneuverIndex' | 'maneuver' | 'distanceToManeuver'>,
  speed: number | null | undefined,
  announced: Set<string>,
): string | null {
  const v = Math.max(0, speed ?? 0);
  const early = v > 22 ? 1000 : v > 14 ? 500 : 250;
  const now = Math.max(40, v * 4);
  const d = s.distanceToManeuver;
  const nowKey = `${s.maneuverIndex}:now`;
  const earlyKey = `${s.maneuverIndex}:early`;
  if (d <= now && !announced.has(nowKey)) {
    announced.add(nowKey);
    announced.add(earlyKey);
    return spokenInstruction(s.maneuver, s.maneuver.type === 'ARRIVE' ? d : null);
  }
  if (d <= early && d > now * 1.5 && !announced.has(earlyKey)) {
    announced.add(earlyKey);
    return spokenInstruction(s.maneuver, d);
  }
  return null;
}

// ─── Kamera & Zeit ────────────────────────────────────────────────────────

/** Kamera je nach Tempo: langsam = nah, Autobahn = weiter weg. */
export function cameraForSpeed(speedMs: number | null | undefined): { zoom: number; altitude: number; pitch: number } {
  const v = Math.max(0, speedMs ?? 0);
  if (v < 8) return { zoom: 17.5, altitude: 320, pitch: 50 };
  if (v < 15) return { zoom: 17, altitude: 480, pitch: 50 };
  if (v < 23) return { zoom: 16, altitude: 850, pitch: 45 };
  return { zoom: 15, altitude: 1500, pitch: 40 };
}

/** "8 Min.", "1 Std. 5 Min." */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} Min.`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

/** Ankunftszeit "14:32". */
export function formatArrival(secondsFromNow: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() + secondsFromNow * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Punkt in `meters` Entfernung vom Start entlang der Route (für Simulation). */
export function pointAlong(p: PreparedRoute, meters: number): { lat: number; lng: number; bearing: number; segment: number } {
  const c = p.route.coordinates;
  const d = Math.max(0, Math.min(p.length, meters));
  let i = 0;
  while (i < c.length - 2 && p.cum[i + 1]! < d) i++;
  const span = p.cum[i + 1]! - p.cum[i]!;
  const t = span > 0 ? (d - p.cum[i]!) / span : 0;
  const a = c[i]!;
  const b = c[i + 1]!;
  return {
    lat: a[0] + t * (b[0] - a[0]),
    lng: a[1] + t * (b[1] - a[1]),
    bearing: bearingDegrees(pt(a), pt(b)),
    segment: i,
  };
}
