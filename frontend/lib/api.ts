// Thin client for the Rails API (same origin via the /api rewrite). Mutating requests carry the
// CSRF token issued by GET /api/session; the session itself is an httpOnly cookie.

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const SESSION_EXPIRED_EVENT = "session-expired";
export const PASSWORD_CHANGE_EVENT = "password-change-required";

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

async function ensureCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const res = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
    const body = await res.json();
    csrfToken = body.csrf_token;
  }
  return csrfToken as string;
}

type Query = Record<string, string | number | undefined | null>;

export function withQuery(path: string, query: Query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let payload: BodyInit | undefined;

  if (method !== "GET") headers["X-CSRF-Token"] = await ensureCsrfToken();
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection and try again.", 0, "network_error");
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = data?.error ?? {};
    // A stale CSRF token (e.g. after the session was reset) is refreshed once transparently.
    if (error.code === "invalid_csrf_token" && !retried) {
      csrfToken = null;
      return request<T>(method, path, body, true);
    }
    // Lets the session provider return the user to the sign-in page.
    if (res.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    // The account must choose a new password first: the session provider reloads the user, which shows the form.
    if (error.code === "password_change_required" && typeof window !== "undefined") window.dispatchEvent(new Event(PASSWORD_CHANGE_EVENT));
    throw new ApiError(error.message ?? `Request failed (${res.status}).`, res.status, error.code, error.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("GET", withQuery(path, query)),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
