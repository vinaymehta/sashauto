"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, SESSION_EXPIRED_EVENT, setCsrfToken } from "@/lib/api";
import type { User } from "@/lib/types";
import { clearApiCache } from "./use-api";

interface SessionState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

interface SessionResponse {
  user: User | null;
  csrf_token: string;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.get<SessionResponse>("/api/session")
      .then((res) => {
        if (!active) return;
        setCsrfToken(res.csrf_token);
        setUser(res.user);
      })
      .catch(() => active && setUser(null))
      .finally(() => active && setLoading(false));
    const onExpired = () => { clearApiCache(); setUser(null); };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => {
      active = false;
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.post<SessionResponse>("/api/session", { email, password });
    setCsrfToken(res.csrf_token); // the session is reset on sign-in, which rotates the token
    setUser(res.user);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.delete("/api/session");
    } finally {
      clearApiCache(); // never show one user's data to the next
      setCsrfToken(null);
      setUser(null);
    }
  }, []);

  return <SessionContext.Provider value={{ user, loading, signIn, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
