import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  FacilityDetail,
  FavoriteItem,
  FavoriteTarget,
  MapResponse,
  NearbyItem,
  ReportReviewInput,
  UpsertReviewInput,
} from '@parking/shared';
import { api } from '@/lib/api';
import type { Coordinates } from '@/features/location/LocationProvider';

/* ─────────────── Favoriten ─────────────── */

export function useFavorites(from: Coordinates | null) {
  const lat = from ? Number(from.lat.toFixed(3)) : undefined;
  const lng = from ? Number(from.lng.toFixed(3)) : undefined;
  return useQuery({
    queryKey: ['favorites', lat, lng],
    queryFn: () => api.favorites.list(lat !== undefined && lng !== undefined ? { lat, lng } : undefined),
  });
}

/** Setzt isFavorite in allen gecachten Karten-, Nähe- und Detaildaten (optimistisch). */
function patchFavoriteEverywhere(qc: QueryClient, target: FavoriteTarget, value: boolean) {
  const patch = <T extends { id: string; isFavorite: boolean }>(item: T): T =>
    item.id === target.id ? { ...item, isFavorite: value } : item;

  qc.setQueriesData<MapResponse>({ queryKey: ['map'] }, (d) => (d ? { ...d, items: d.items.map(patch) } : d));
  qc.setQueriesData<NearbyItem[]>({ queryKey: ['nearby'] }, (d) => d?.map(patch));
  qc.setQueryData<FacilityDetail>(['facility', target.id], (d) => (d ? { ...d, isFavorite: value } : d));
  if (!value) {
    qc.setQueriesData<FavoriteItem[]>({ queryKey: ['favorites'] }, (d) => d?.filter((f) => f.id !== target.id));
  }
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ target, value }: { target: FavoriteTarget; value: boolean }) =>
      value ? api.favorites.add(target) : api.favorites.remove(target),
    onMutate: async ({ target, value }) => {
      await qc.cancelQueries({ queryKey: ['map'] });
      patchFavoriteEverywhere(qc, target, value);
    },
    onError: (_err, { target, value }) => patchFavoriteEverywhere(qc, target, !value),
    onSettled: () => {
      // Im Cluster-Modus wandert ein neuer Favorit aus dem Cluster heraus -> neu laden
      void qc.invalidateQueries({ queryKey: ['map'] });
      void qc.invalidateQueries({ queryKey: ['favorites'] });
    },
  });
}

/* ─────────────── Bewertungen ─────────────── */

export function useFacilityReviews(facilityId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['reviews', 'facility', facilityId],
    queryFn: ({ pageParam }) => api.reviews.forFacility(facilityId!, { limit: 10, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!facilityId,
  });
}

const invalidateReviewData = (qc: QueryClient, facilityId: string) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: ['reviews', 'facility', facilityId] }),
    qc.invalidateQueries({ queryKey: ['facility', facilityId] }),
    qc.invalidateQueries({ queryKey: ['my-reviews'] }),
    qc.invalidateQueries({ queryKey: ['map'] }),
    qc.invalidateQueries({ queryKey: ['nearby'] }),
  ]);

export function useUpsertFacilityReview(facilityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertReviewInput) => api.reviews.upsertForFacility(facilityId, input),
    onSuccess: () => invalidateReviewData(qc, facilityId),
  });
}

export function useDeleteFacilityReview(facilityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.reviews.deleteForFacility(facilityId),
    onSuccess: () => invalidateReviewData(qc, facilityId),
  });
}

export function useMyReviews() {
  return useQuery({ queryKey: ['my-reviews'], queryFn: () => api.reviews.mine() });
}

export function useReportReview() {
  return useMutation({
    mutationFn: ({ reviewId, input }: { reviewId: string; input: ReportReviewInput }) => api.reviews.report(reviewId, input),
  });
}
