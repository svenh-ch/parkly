import type {
  AccessMethod,
  Amenity,
  CancellationPolicy,
  EvConnector,
  PublishIssue,
  SpotStatus,
  SpotType,
  VehicleType,
} from '@parking/shared';
import type { IMAGE_KINDS } from '@parking/shared';

export const SPOT_TYPE_LABEL: Record<SpotType, string> = {
  OUTDOOR: 'Aussenparkplatz',
  CARPORT: 'Carport',
  GARAGE: 'Garage / Box',
  UNDERGROUND: 'Tiefgarage',
};

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  MOTORCYCLE: 'Motorrad',
  SMALL_CAR: 'Kleinwagen',
  CAR: 'Mittelklasse',
  SUV: 'SUV / Kombi',
  VAN: 'Kleinbus / Van',
};

export const AMENITY_LABEL: Record<Amenity, string> = {
  LIGHTING: 'Beleuchtet',
  CCTV: 'Videoüberwacht',
  GATE: 'Tor / Schranke',
  WIDE: 'Breiter Platz',
  EASY_ACCESS: 'Einfache Zufahrt',
  NEAR_TRANSIT: 'Nahe ÖV',
};

export const ACCESS_LABEL: Record<AccessMethod, string> = {
  OPEN: 'Frei zugänglich',
  KEY: 'Schlüssel',
  REMOTE: 'Fernbedienung',
  CODE: 'Zahlencode',
  CARD: 'Badge / Karte',
  APP: 'App / Handy',
};

export const EV_LABEL: Record<EvConnector, string> = {
  TYPE2: 'Typ 2',
  CCS: 'CCS',
  CHADEMO: 'CHAdeMO',
  SCHUKO: 'Haushaltsstecker',
  CEE: 'CEE (Industrie)',
};

export const IMAGE_KIND_LABEL: Record<(typeof IMAGE_KINDS)[number], string> = {
  FRONT: 'Platz',
  TOP: 'Übersicht',
  ACCESS: 'Zufahrt',
  ENTRANCE: 'Einfahrt',
  GARAGE: 'Innen',
  SURROUNDINGS: 'Umgebung',
  OTHER: 'Weiteres',
};

export const CANCELLATION_LABEL: Record<CancellationPolicy, { title: string; text: string }> = {
  FLEXIBLE: { title: 'Flexibel', text: 'Kostenlos stornierbar bis 1 Stunde vor Beginn.' },
  MODERATE: { title: 'Moderat', text: 'Kostenlos stornierbar bis 24 Stunden vor Beginn.' },
  STRICT: { title: 'Streng', text: 'Kostenlos stornierbar bis 7 Tage vor Beginn.' },
};

export const STATUS_LABEL: Record<SpotStatus, string> = {
  DRAFT: 'Entwurf',
  PENDING_REVIEW: 'In Prüfung',
  ACTIVE: 'Aktiv',
  PAUSED: 'Pausiert',
  SUSPENDED: 'Gesperrt',
};

export const ISSUE_LABEL: Record<PublishIssue, string> = {
  TITLE: 'Titel (mindestens 5 Zeichen)',
  PRICE: 'Mindestens ein Preis',
  IMAGES: 'Mindestens 3 Fotos',
  AVAILABILITY: 'Verfügbare Zeiten',
  RIGHTS: 'Bestätigung, dass du vermieten darfst',
  DURATION: 'Höchstdauer ≥ Mindestdauer',
};

export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

/** Rappen -> "12.50" */
export const chf = (rappen: number) => (rappen / 100).toFixed(2).replace(/\.00$/, '.–');

/** "12.50" / "12,5" / "12" -> Rappen oder null */
export function parseChf(text: string): number | null {
  const t = text.replace(/[’'\s]/g, '').replace(',', '.').replace(/\.–$/, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export const minutesLabel = (m: number) =>
  m % 1440 === 0 ? `${m / 1440} ${m === 1440 ? 'Tag' : 'Tage'}` : m % 60 === 0 ? `${m / 60} Std.` : `${m} Min.`;

export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
