import { AppState, Platform } from 'react-native';
import { focusManager, QueryClient } from '@tanstack/react-query';
import { ApiError } from '@parking/api-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Client-Fehler (4xx) nicht wiederholen
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

// Daten beim Zurückkehren in die App aktualisieren
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (status) => focusManager.setFocused(status === 'active'));
}

export const queryKeys = {
  me: ['me'] as const,
};
