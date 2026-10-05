"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Query = Record<string, string | number | undefined | null>;

interface LoadState<T> {
  key: string | null; // request the current data/error belong to
  data: T | null;
  error: ApiError | null;
}

// Last response per request, so revisiting a page renders instantly (stale-while-revalidate)
// instead of flashing loading placeholders. Cleared on sign-out.
const cache = new Map<string, unknown>();
const MAX_ENTRIES = 200;

export function clearApiCache() {
  cache.clear();
}

function remember(key: string, data: unknown) {
  cache.delete(key);
  cache.set(key, data);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

// Requests in flight, so the same request is sent once even when several components (or React's
// development double-run of effects) ask for it at the same time.
const inflight = new Map<string, Promise<unknown>>();

function load<T>(key: string, path: string, query: Query): Promise<T> {
  let promise = inflight.get(key);
  if (!promise) {
    promise = api.get<T>(path, query).finally(() => inflight.delete(key));
    inflight.set(key, promise);
  }
  return promise as Promise<T>;
}

// Loads a GET endpoint and reloads when the path or query changes. Pass null to skip loading.
// Cached or previous data stays visible while a new request is in flight.
export function useApi<T>(path: string | null, query: Query = {}) {
  const [nonce, setNonce] = useState(0);
  const requestKey = path === null ? null : `${path}|${JSON.stringify(query)}`;
  const [state, setState] = useState<LoadState<T>>(() => ({
    key: null,
    data: requestKey !== null && cache.has(requestKey) ? (cache.get(requestKey) as T) : null,
    error: null,
  }));
  const key = requestKey === null ? null : `${requestKey}|${nonce}`;

  useEffect(() => {
    if (key === null || path === null || requestKey === null) return;
    let active = true;
    load<T>(key, path, query)
      .then((data) => {
        remember(requestKey, data);
        if (active) setState({ key, data, error: null });
      })
      .catch((err: unknown) => {
        if (!active) return;
        const error = err instanceof ApiError ? err : new ApiError("Something went wrong.", 0);
        setState((s) => ({ key, data: s.data, error }));
      });
    return () => {
      active = false;
    };
    // `key` captures path, query (by value) and reload requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Show the cached response for a new query immediately (e.g. going back to page 1).
  const cached = requestKey !== null && state.key !== key && cache.has(requestKey) ? (cache.get(requestKey) as T) : null;
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: cached ?? state.data, error: state.error, loading: key !== null && state.key !== key, reload };
}

export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
