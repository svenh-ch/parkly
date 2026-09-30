import { forwardRef, useImperativeHandle, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, Text } from '@/ui';
import type { RouteMapHandle, RouteMapProps } from './RouteMap';

/**
 * Web-Vorschau: react-native-maps gibt es im Browser nicht. Wir zeichnen die Route als SVG,
 * damit Ablauf und Oberfläche im Browser testbar sind. Auf dem Handy läuft die echte Karte.
 */
export const RouteMap = forwardRef<RouteMapHandle, RouteMapProps>(function RouteMap(props, ref) {
  useImperativeHandle(ref, () => ({ fit: () => undefined, overview: () => undefined, follow: () => undefined }));

  const view = useMemo(() => {
    const pts = [...props.line, [props.destination.lat, props.destination.lng] as [number, number]];
    if (props.car) pts.push([props.car.lat, props.car.lng]);
    const lats = pts.map((p) => p[0]);
    const lngs = pts.map((p) => p[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
    const w = Math.max(1e-6, (maxLng - minLng) * k);
    const h = Math.max(1e-6, maxLat - minLat);
    const s = 800 / Math.max(w, h);
    const proj = (lat: number, lng: number) => [100 + (lng - minLng) * k * s, 100 + (maxLat - lat) * s] as const;
    return { proj, width: 200 + w * s, height: 200 + h * s };
  }, [props.line, props.destination, props.car]);

  const path = props.line.map(([lat, lng]) => view.proj(lat, lng).join(',')).join(' ');
  const dest = view.proj(props.destination.lat, props.destination.lng);
  const car = props.car ? view.proj(props.car.lat, props.car.lng) : null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.bg, { paddingTop: props.topInset, paddingBottom: props.bottomInset }]}>
      <svg viewBox={`0 0 ${view.width} ${view.height}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
        <polyline points={path} fill="none" stroke={colors.primary} strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={path} fill="none" stroke={colors.accent} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={dest[0]} cy={dest[1]} r={22} fill={colors.primary} stroke="#fff" strokeWidth={6} />
        <text x={dest[0]} y={dest[1] + 8} textAnchor="middle" fontSize={24} fontWeight={800} fill="#fff">
          P
        </text>
        {car ? (
          <g transform={`translate(${car[0]},${car[1]}) rotate(${props.car!.bearing})`}>
            <circle r={34} fill="rgba(31,79,216,0.16)" />
            <rect x={-12} y={-21} width={24} height={42} rx={9} fill={colors.primary} stroke="#fff" strokeWidth={3} />
            <rect x={-7} y={-13} width={14} height={8} rx={3} fill="#8FB0FF" />
          </g>
        ) : null}
      </svg>
      <Text variant="caption" tone="secondary" style={styles.note}>
        Web-Vorschau · echte Karte in der App
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  bg: { backgroundColor: '#E9EEF3' },
  note: { position: 'absolute', left: 12, bottom: 12 },
});
