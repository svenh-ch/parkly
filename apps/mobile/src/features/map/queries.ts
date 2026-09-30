import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { zoomFromLongitudeDelta, type ParkingKind } from '@parking/shared';
import { api } from '@/lib/api';
import type { Coordinates } from '@/features/location/LocationProvider';

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** Rundet auf ein Raster, damit kleine Kartenbewegungen den Cache wiederverwenden. */
const snap = (v: number, step: number) => Math.round(v / step) * step;

export function regionToQuery(region: MapRegion, kinds: ParkingKind[], favoritesOnly = false) {
  const zoom = Math.round(zoomFromLongitudeDelta(region.longitudeDelta));
  // 20 % Rand, damit Pins am Bildschirmrand nicht erst beim Verschieben erscheinen
  const padLng = region.longitudeDelta * 0.7;
  const padLat = region.latitudeDelta * 0.7;
  const step = region.longitudeDelta / 8;
  return {
    minLng: snap(region.longitude - padLng, step),
    maxLng: snap(region.longitude + padLng, step),
    minLat: Math.max(-85, snap(region.latitude - padLat, step)),
    maxLat: Math.min(85, snap(region.latitude + padLat, step)),
    zoom,
    kinds,
    favoritesOnly,
  };
}

export function useMapItems(region: MapRegion | null, kinds: ParkingKind[], favoritesOnly = false) {
  const query = region ? regionToQuery(region, kinds, favoritesOnly) : null;
  return useQuery({
    queryKey: ['map', query],
    queryFn: ({ signal }) => api.map.inBounds(query!, signal),
    enabled: query !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useNearby(center: Coordinates) {
  const lat = Number(center.lat.toFixed(3));
  const lng = Number(center.lng.toFixed(3));
  return useQuery({
    queryKey: ['nearby', lat, lng],
    queryFn: () => api.map.nearby({ lat, lng, limit: 10 }),
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
  });
}

export function useFacility(id: string | undefined) {
  return useQuery({
    queryKey: ['facility', id],
    queryFn: () => api.map.facility(id!),
    enabled: !!id,
    refetchInterval: 3 * 60_000,
  });
}

/** "Parken bei …": nächste Parkplätze zu einem gesuchten Ort, nach Gehdistanz sortiert. */
export function usePlaceParking(place: Coordinates | null) {
  const lat = place ? Number(place.lat.toFixed(5)) : 0;
  const lng = place ? Number(place.lng.toFixed(5)) : 0;
  return useQuery({
    queryKey: ['place-parking', lat, lng],
    queryFn: () => api.map.nearby({ lat, lng, limit: 8, walk: true }),
    enabled: place !== null,
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
  });
}
