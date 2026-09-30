import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HostSpot, UpdateSpotInput } from '@parking/shared';
import { api } from '@/lib/api';

export const hostKeys = {
  list: ['host', 'spots'] as const,
  spot: (id: string) => ['host', 'spot', id] as const,
  fee: ['host', 'fee'] as const,
};

export function useHostSpots(enabled = true) {
  return useQuery({ queryKey: hostKeys.list, queryFn: () => api.host.list(), enabled });
}

export function useHostSpot(id: string | null) {
  return useQuery({ queryKey: hostKeys.spot(id ?? ''), queryFn: () => api.host.get(id!), enabled: !!id });
}

export function useHostFee() {
  return useQuery({ queryKey: hostKeys.fee, queryFn: () => api.host.fee(), staleTime: 10 * 60_000 });
}

/** Nach jeder Änderung: Detail aktualisieren, Liste und Karte neu laden. */
export function useSpotCache() {
  const qc = useQueryClient();
  return (spot: HostSpot) => {
    qc.setQueryData(hostKeys.spot(spot.id), spot);
    void qc.invalidateQueries({ queryKey: hostKeys.list });
    void qc.invalidateQueries({ queryKey: ['map'] });
    void qc.invalidateQueries({ queryKey: ['nearby'] });
  };
}

export function useUpdateSpot(id: string) {
  const put = useSpotCache();
  return useMutation({ mutationFn: (input: UpdateSpotInput) => api.host.update(id, input), onSuccess: put });
}

export function useSpotAction() {
  const put = useSpotCache();
  const qc = useQueryClient();
  return {
    publish: useMutation({ mutationFn: (id: string) => api.host.publish(id), onSuccess: put }),
    pause: useMutation({ mutationFn: (id: string) => api.host.pause(id), onSuccess: put }),
    remove: useMutation({
      mutationFn: (id: string) => api.host.remove(id),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: hostKeys.list });
        void qc.invalidateQueries({ queryKey: ['map'] });
      },
    }),
  };
}
