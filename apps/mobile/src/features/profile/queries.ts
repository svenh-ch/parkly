import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BecomeHostInput, UpdateMeInput } from '@parking/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { useAuth } from '@/features/auth/AuthProvider';

export function useMe() {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.me.get(),
    enabled: status === 'signedIn',
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMeInput) => api.me.update(input),
    onSuccess: (me) => qc.setQueryData(queryKeys.me, me),
  });
}

export function useBecomeHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BecomeHostInput) => api.me.becomeHost(input),
    onSuccess: (me) => qc.setQueryData(queryKeys.me, me),
  });
}

export function useDeleteAccount() {
  const { signOut } = useAuth();
  return useMutation({
    mutationFn: () => api.me.delete(),
    onSuccess: () => signOut(),
  });
}

export function displayName(me: { firstName: string | null; lastName: string | null; email: string }) {
  const full = [me.firstName, me.lastName].filter(Boolean).join(' ');
  return full || me.email;
}
