const API_BASE = "/api";

export class OfflineError extends Error {
  constructor() {
    super("You're offline. Check your connection and try again.");
    this.name = "OfflineError";
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...init,
    });
  } catch {
    // fetch() throws a plain TypeError (not an HTTP response) when the request never
    // reached the server at all — no connectivity, DNS failure, connection refused, etc.
    throw new OfflineError();
  }

  if (res.status === 401 && !path.startsWith("/auth/")) {
    window.location.hash = "/login";
    throw new Error(`${init.method ?? "GET"} ${path} failed: 401`);
  }
  if (!res.ok) {
    const method = init.method ?? "GET";
    throw new Error(`${method} ${path} failed: ${res.status}`);
  }
  return res.json();
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

/** Returns a user-facing message for a caught API error, distinguishing offline from other failures. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof OfflineError) return err.message;
  return fallback;
}

/** Set once at boot from GET /auth/me; pages check this to decide whether to render price info. */
let currentUserIsAdmin = false;

export function setCurrentUserIsAdmin(value: boolean): void {
  currentUserIsAdmin = value;
}

export function isAdmin(): boolean {
  return currentUserIsAdmin;
}

/** Set once at boot from GET /auth/me; the logged-in user's Odoo display name (res.users.name). */
let currentUserName = "";

export function setCurrentUserName(value: string): void {
  currentUserName = value;
}

export function getCurrentUserName(): string {
  return currentUserName;
}
