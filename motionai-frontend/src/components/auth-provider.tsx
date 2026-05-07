"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase";

type AuthContextValue = {
  authAvailable: boolean;
  isAuthReady: boolean;
  session: Session | null;
  user: User | null;
  signInWithPassword: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null }>;
  signUpWithPassword: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const authAvailable = isSupabaseConfigured();
  const [isAuthReady, setIsAuthReady] = useState(!authAvailable);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      return;
    }

    let isMounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) {
        return;
      }

      setSession(data.session);
      setUser(data.session?.user ?? null);
      setIsAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setIsAuthReady(true);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      authAvailable,
      isAuthReady,
      session,
      user,
      async signInWithPassword(email: string, password: string) {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) {
          return { error: "Supabase auth is not configured for this frontend." };
        }

        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        return { error: error?.message ?? null };
      },
      async signUpWithPassword(email: string, password: string) {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) {
          return {
            error: "Supabase auth is not configured for this frontend.",
            needsEmailConfirmation: false,
          };
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        return {
          error: error?.message ?? null,
          needsEmailConfirmation: !data.session,
        };
      },
      async signOut() {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) {
          return;
        }

        await supabase.auth.signOut();
      },
    }),
    [authAvailable, isAuthReady, session, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }

  return context;
}
