import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import type { SignInInput, SignUpInput } from '@parking/shared';
import { api } from '@/lib/api';
import { queryClient, queryKeys } from '@/lib/query-client';
import { supabase } from '@/lib/supabase';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  /** true, während ein Passwort-Reset-Link aktiv ist (Recovery-Session). */
  isRecovering: boolean;
  signIn: (input: SignInInput) => Promise<void>;
  /** Liefert needsConfirmation=true, wenn die E-Mail zuerst bestätigt werden muss. */
  signUp: (input: SignUpInput) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  completePasswordReset: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Überträgt Name und AGB-Zustimmung aus der Registrierung ins App-Profil.
 * Läuft nach der ersten Anmeldung (auch wenn die E-Mail erst später bestätigt wurde).
 */
async function syncProfileFromSignUp(session: Session) {
  const meta = session.user.user_metadata as { first_name?: string; last_name?: string; terms_accepted?: boolean };
  if (!meta.first_name && !meta.terms_accepted) return;
  const me = await api.me.get();
  if (me.firstName) return;
  let updated = await api.me.update({ firstName: meta.first_name, lastName: meta.last_name });
  if (meta.terms_accepted) updated = await api.me.acceptTerms();
  queryClient.setQueryData(queryKeys.me, updated);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        setStatus(data.session ? 'signedIn' : 'signedOut');
      })
      .catch(() => mounted && setStatus('signedOut'));

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      setStatus(next ? 'signedIn' : 'signedOut');
      if (event === 'PASSWORD_RECOVERY') setIsRecovering(true);
      if (event === 'SIGNED_OUT') {
        setIsRecovering(false);
        queryClient.clear();
      }
      if (event === 'SIGNED_IN' && next) {
        syncProfileFromSignUp(next).catch(() => undefined);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async ({ email, password }: SignInInput) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: { first_name: input.firstName, last_name: input.lastName, terms_accepted: input.acceptTerms },
      },
    });
    if (error) throw error;
    return { needsConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) await supabase.auth.signOut({ scope: 'local' });
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: Linking.createURL('/reset-password'),
    });
    if (error) throw error;
  }, []);

  const completePasswordReset = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    setIsRecovering(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, isRecovering, signIn, signUp, signOut, requestPasswordReset, completePasswordReset }),
    [status, session, isRecovering, signIn, signUp, signOut, requestPasswordReset, completePasswordReset],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth muss innerhalb von <AuthProvider> verwendet werden');
  return ctx;
}
