import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import {
  dueAnnouncement,
  NavigationTracker,
  pointAlong,
  type Fix,
  type NavSnapshot,
  type Route,
} from '@parking/shared';
import { api } from '@/lib/api';

export type NavPhase = 'overview' | 'navigating' | 'arrived';

const KEEP_AWAKE_TAG = 'parkly-navigation';
/** Mindestabstand zwischen zwei Neuberechnungen. */
const REROUTE_COOLDOWN_MS = 8_000;
/** Simulation: Tempo in m/s (≈ 54 km/h) und Takt. */
const SIM_SPEED = 15;
const SIM_TICK_MS = 1_000;

/** Testfahrt ohne Auto: in der Entwicklung immer, sonst nur mit EXPO_PUBLIC_ENABLE_ROUTE_SIM=1. */
export const SIMULATION_AVAILABLE = __DEV__ || process.env.EXPO_PUBLIC_ENABLE_ROUTE_SIM === '1';

/** Wake Lock freigeben; wirft im Browser, wenn er nie aktiv war. */
function releaseKeepAwake() {
  try {
    const r = deactivateKeepAwake(KEEP_AWAKE_TAG) as unknown;
    if (r instanceof Promise) r.catch(() => undefined);
  } catch {
    /* war nicht aktiv */
  }
}

function speak(text: string) {
  Speech.stop();
  Speech.speak(text, { language: 'de-DE', rate: Platform.OS === 'ios' ? 0.52 : 1 });
}

/**
 * Steuert eine Navigation: GPS (oder Simulation) -> Tracker -> Anzeige, Ansagen,
 * Neuberechnung und Ankunft. Der Standort verlässt das Gerät nur für eine Neuberechnung
 * (an unsere API und von dort an den Routing-Dienst), gespeichert wird er nirgends.
 */
export function useRouteNavigation(destination: { lat: number; lng: number }) {
  const [route, setRoute] = useState<Route | null>(null);
  const [phase, setPhase] = useState<NavPhase>('overview');
  const [snapshot, setSnapshot] = useState<NavSnapshot | null>(null);
  const [lastFix, setLastFix] = useState<Fix | null>(null);
  const [rerouting, setRerouting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [simulating, setSimulating] = useState(false);

  const tracker = useRef<NavigationTracker | null>(null);
  const announced = useRef(new Set<string>());
  const reroute = useRef({ inFlight: false, last: 0 });
  const source = useRef<{ remove(): void } | null>(null);
  const mutedRef = useRef(false);
  const phaseRef = useRef<NavPhase>('overview');
  phaseRef.current = phase;

  const say = useCallback((text: string) => {
    if (!mutedRef.current) speak(text);
  }, []);

  const stopSource = useCallback(() => {
    source.current?.remove();
    source.current = null;
    releaseKeepAwake();
  }, []);

  const adoptRoute = useCallback((r: Route) => {
    setRoute(r);
    tracker.current = new NavigationTracker(r);
    announced.current = new Set();
  }, []);

  const doReroute = useCallback(
    async (fix: Fix) => {
      const state = reroute.current;
      if (state.inFlight || Date.now() - state.last < REROUTE_COOLDOWN_MS) return;
      state.inFlight = true;
      setRerouting(true);
      say('Route wird neu berechnet');
      try {
        const r = await api.route.get({ lat: fix.lat, lng: fix.lng }, destination);
        if (phaseRef.current === 'navigating') adoptRoute(r);
      } catch {
        // Alte Route behalten; nächster Versuch nach der Wartezeit
      } finally {
        state.inFlight = false;
        state.last = Date.now();
        setRerouting(false);
      }
    },
    [adoptRoute, destination, say],
  );

  const handleFix = useCallback(
    (fix: Fix) => {
      const t = tracker.current;
      if (!t || phaseRef.current !== 'navigating') return;
      const s = t.update(fix);
      setSnapshot(s);
      setLastFix(fix);
      if (s.arrived) {
        stopSource();
        setSimulating(false);
        setPhase('arrived');
        say('Du hast dein Ziel erreicht');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        return;
      }
      if (s.offRoute) {
        void doReroute(fix);
        return;
      }
      const text = dueAnnouncement(s, fix.speed, announced.current);
      if (text) {
        say(text);
        if (text.startsWith('Jetzt')) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      }
    },
    [doReroute, say, stopSource],
  );
  const handleFixRef = useRef(handleFix);
  handleFixRef.current = handleFix;

  const start = useCallback(
    async (opts: { simulate?: boolean } = {}) => {
      if (!route) return;
      adoptRoute(route);
      reroute.current = { inFlight: false, last: 0 };
      setSnapshot(null);
      setPhase('navigating');
      phaseRef.current = 'navigating';
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
      const minutes = Math.max(1, Math.round(route.durationSeconds / 60));
      say(`Los geht's. Ankunft in etwa ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}.`);

      source.current?.remove();
      source.current = null;
      if (opts.simulate) {
        setSimulating(true);
        let meters = 0;
        const emit = () => {
          const t = tracker.current;
          if (!t) return;
          const p = pointAlong(t.prepared, meters);
          handleFixRef.current({ lat: p.lat, lng: p.lng, speed: SIM_SPEED, heading: p.bearing, accuracy: 5 });
          meters = Math.min(t.prepared.length, meters + SIM_SPEED * (SIM_TICK_MS / 1000));
        };
        emit();
        const id = setInterval(emit, SIM_TICK_MS);
        source.current = { remove: () => clearInterval(id) };
        return;
      }
      setSimulating(false);
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1_000, distanceInterval: 2 },
        (pos) =>
          handleFixRef.current({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            speed: pos.coords.speed,
            heading: pos.coords.heading,
          }),
      );
      // Falls inzwischen beendet wurde
      if (phaseRef.current !== 'navigating') sub.remove();
      else source.current = sub;
    },
    [adoptRoute, route, say, stopSource],
  );

  const stop = useCallback(() => {
    stopSource();
    Speech.stop();
    setSimulating(false);
    setSnapshot(null);
    setPhase('overview');
    phaseRef.current = 'overview';
  }, [stopSource]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      mutedRef.current = !m;
      if (!m) Speech.stop();
      return !m;
    });
  }, []);

  // Beim Verlassen des Screens alles sauber beenden
  useEffect(
    () => () => {
      source.current?.remove();
      releaseKeepAwake();
      Speech.stop();
    },
    [],
  );

  return {
    route,
    setInitialRoute: setRoute,
    phase,
    snapshot,
    lastFix,
    rerouting,
    muted,
    simulating,
    start,
    stop,
    toggleMute,
  };
}
