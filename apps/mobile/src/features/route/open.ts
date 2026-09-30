import { router } from 'expo-router';

export interface RouteTarget {
  lat: number;
  lng: number;
  name: string;
  /** Parkhaus-ID für "Parkhaus-Details" nach der Ankunft. */
  facilityId?: string;
}

/** Öffnet die Route in der App (Übersicht mit "Losfahren"). */
export function openInAppRoute(t: RouteTarget) {
  router.push({
    pathname: '/route',
    params: { lat: String(t.lat), lng: String(t.lng), name: t.name, facilityId: t.facilityId ?? '' },
  });
}
