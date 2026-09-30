import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Booking } from '@parking/shared';
import { api } from '@/lib/api';

export const bookingKeys = {
  list: ['bookings'] as const,
  one: (id: string) => ['booking', id] as const,
  host: ['host', 'bookings'] as const,
  loyalty: ['loyalty'] as const,
  payouts: ['host', 'payouts'] as const,
  config: ['payments', 'config'] as const,
};

export function useBookings() {
  return useQuery({ queryKey: bookingKeys.list, queryFn: () => api.bookings.list() });
}

export function useBooking(id: string | undefined) {
  return useQuery({ queryKey: bookingKeys.one(id ?? ''), queryFn: () => api.bookings.get(id!), enabled: !!id });
}

export function useHostBookings(enabled = true) {
  return useQuery({ queryKey: bookingKeys.host, queryFn: () => api.hostBookings.list(), enabled });
}

export function useLoyalty(enabled = true) {
  return useQuery({ queryKey: bookingKeys.loyalty, queryFn: () => api.loyalty.get(), staleTime: 60_000, enabled });
}

export function usePayouts() {
  return useQuery({ queryKey: bookingKeys.payouts, queryFn: () => api.hostBookings.payouts() });
}

export function usePaymentConfig() {
  return useQuery({ queryKey: bookingKeys.config, queryFn: () => api.payments.config(), staleTime: 10 * 60_000 });
}

/** Nach jeder Änderung an einer Buchung: Detail setzen, Listen neu laden. */
export function useBookingCache() {
  const qc = useQueryClient();
  return (b: Booking) => {
    qc.setQueryData(bookingKeys.one(b.id), b);
    void qc.invalidateQueries({ queryKey: bookingKeys.list });
    void qc.invalidateQueries({ queryKey: bookingKeys.host });
    void qc.invalidateQueries({ queryKey: bookingKeys.loyalty });
  };
}
