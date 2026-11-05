"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, PASSWORD_CHANGE_EVENT, SESSION_EXPIRED_EVENT, setCsrfToken } from "@/lib/api";
import type { User } from "@/lib/types";
import { clearApiCache } from "./use-api";

interface SessionState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  // The signed-in user changes their own password; the session continues with the updated user.
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  // Reloads the signed-in user (e.g. after an admin changed their own name, email or role).
  refresh: () => Promise<void>;
  // Saves the Orders table columns the signed-in user shows (shown at once; restored if saving fails).
  saveOrdersColumns: (shown: string[]) => Promise<void>;
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
    // The server requires a new password first: reload the user so the app shows the change-password form.
    const onPasswordChange = () => {
      api.get<SessionResponse>("/api/session").then((res) => { setCsrfToken(res.csrf_token); setUser(res.user); }).catch(() => undefined);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    window.addEventListener(PASSWORD_CHANGE_EVENT, onPasswordChange);
    return () => {
      active = false;
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
      window.removeEventListener(PASSWORD_CHANGE_EVENT, onPasswordChange);
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

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const res = await api.patch<SessionResponse>("/api/session/password", { current_password: currentPassword, new_password: newPassword });
    setCsrfToken(res.csrf_token);
    setUser(res.user);
  }, []);

  const refresh = useCallback(async () => {
    const res = await api.get<SessionResponse>("/api/session");
    setCsrfToken(res.csrf_token);
    setUser(res.user);
  }, []);

  const saveOrdersColumns = useCallback(async (shown: string[]) => {
    let before: string[] | null = null;
    setUser((u) => { before = u?.orders_columns ?? null; return u && { ...u, orders_columns: shown }; });
    // The reply is not applied: with quick clicks an earlier reply could arrive last and undo a later click.
    try {
      await api.patch<{ user: User }>("/api/session/orders_columns", { shown });
    } catch (err) {
      setUser((u) => u && { ...u, orders_columns: before });
      throw err;
    }
  }, []);

  return (
    <SessionContext.Provider value={{ user, loading, signIn, signOut, changePassword, refresh, saveOrdersColumns }}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
