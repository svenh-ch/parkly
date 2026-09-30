/**
 * Geo-Helfer, identisch auf Client und Server.
 */

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Luftlinie in Metern (Haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "450 m", "1,2 km", "12 km" */
export function formatDistance(meters: number, locale = 'de-CH'): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  const km = meters / 1000;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km)} km`;
}

/** Zoomstufe aus der sichtbaren Längengrad-Spanne (Web Mercator). */
export function zoomFromLongitudeDelta(longitudeDelta: number): number {
  const delta = Math.min(360, Math.max(1e-6, longitudeDelta));
  return Math.max(0, Math.min(22, Math.log2(360 / delta)));
}

/** Normalisiert einen Kartenausschnitt: klemmt auf gültige Koordinaten, erkennt "ganze Welt". */
export function normalizeBbox(b: { minLng: number; minLat: number; maxLng: number; maxLat: number }) {
  const minLat = Math.max(-90, Math.min(b.minLat, b.maxLat));
  const maxLat = Math.min(90, Math.max(b.minLat, b.maxLat));
  if (b.maxLng - b.minLng >= 360) return { minLng: -180, minLat, maxLng: 180, maxLat };
  return { minLng: Math.max(-180, b.minLng), minLat, maxLng: Math.min(180, b.maxLng), maxLat };
}
