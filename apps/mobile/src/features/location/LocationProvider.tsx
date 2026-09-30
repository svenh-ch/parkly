import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking } from 'react-native';
import * as Location from 'expo-location';

/**
 * Standort der App. Datenschutz:
 *  - nur "Beim Verwenden der App" (Vordergrund), nie im Hintergrund
 *  - der Standort bleibt auf dem Gerät; an die API gehen nur Kartenausschnitte bzw.
 *    Suchkoordinaten, die dort nicht gespeichert werden
 */

export type PermissionState = 'unknown' | 'undetermined' | 'granted' | 'denied';

export interface Coordinates {
  lat: number;
  lng: number;
}

interface LocationContextValue {
  permission: PermissionState;
  coords: Coordinates | null;
  /** Fragt die Berechtigung an (oder öffnet die Einstellungen, falls früher abgelehnt). */
  request: () => Promise<void>;
  refresh: () => Promise<Coordinates | null>;
}

/** Fallback, solange kein Standort bekannt ist (Startregion). */
export const DEFAULT_CENTER: Coordinates = { lat: 47.3769, lng: 8.5417 };

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const subscription = useRef<Location.LocationSubscription | null>(null);

  const readPermission = useCallback(async () => {
    const res = await Location.getForegroundPermissionsAsync();
    const state: PermissionState = res.granted ? 'granted' : res.canAskAgain ? 'undetermined' : 'denied';
    setPermission(state);
    return state;
  }, []);

  const startWatching = useCallback(async () => {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }).catch(() => null);
    if (last) setCoords({ lat: last.coords.latitude, lng: last.coords.longitude });
    subscription.current?.remove();
    subscription.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 50, timeInterval: 15_000 },
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    );
  }, []);

  const stopWatching = useCallback(() => {
    subscription.current?.remove();
    subscription.current = null;
  }, []);

  useEffect(() => {
    void readPermission().then((s) => {
      if (s === 'granted') return startWatching();
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // Berechtigung kann in den Einstellungen geändert worden sein
        void readPermission().then((s) => (s === 'granted' ? startWatching() : stopWatching()));
      } else {
        stopWatching();
      }
    });
    return () => {
      sub.remove();
      stopWatching();
    };
  }, [readPermission, startWatching, stopWatching]);

  const request = useCallback(async () => {
    if (permission === 'denied') {
      await Linking.openSettings();
      return;
    }
    const res = await Location.requestForegroundPermissionsAsync();
    const state: PermissionState = res.granted ? 'granted' : res.canAskAgain ? 'undetermined' : 'denied';
    setPermission(state);
    if (state === 'granted') await startWatching();
  }, [permission, startWatching]);

  const refresh = useCallback(async () => {
    if (permission !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
    if (!pos) return null;
    const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setCoords(next);
    return next;
  }, [permission]);

  const value = useMemo(() => ({ permission, coords, request, refresh }), [permission, coords, request, refresh]);
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation muss innerhalb von <LocationProvider> verwendet werden');
  return ctx;
}
