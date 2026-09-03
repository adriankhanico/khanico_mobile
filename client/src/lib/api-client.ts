const API_BASE = "/api";

export class OfflineError extends Error {
  constructor() {
    super("You're offline. Check your connection and try again.");
    this.name = "OfflineError";
  }
}

/** An HTTP error response from the API, carrying the server's own message when it sent one. */
export class ApiError extends Error {
  status: number;
  /** True when `message` came from the server's own { message } body, not a generic fallback. */
  hasServerMessage: boolean;
  constructor(status: number, message: string, hasServerMessage: boolean) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.hasServerMessage = hasServerMessage;
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
    throw new ApiError(401, `${init.method ?? "GET"} ${path} failed: 401`, false);
  }
  if (!res.ok) {
    const method = init.method ?? "GET";
    // Deliberate 4xx validation errors (bad input, conflicts) carry a { message } worth
    // showing the user as-is. 5xx and anything else fall back to each screen's own generic
    // message instead of surfacing raw internal/Odoo error text.
    let message = `${method} ${path} failed: ${res.status}`;
    let hasServerMessage = false;
    if (res.status >= 400 && res.status < 500) {
      try {
        const body = await res.json();
        if (body && typeof body.message === "string") {
          message = body.message;
          hasServerMessage = true;
        }
      } catch {
        // body wasn't JSON — keep the generic message
      }
    }
    throw new ApiError(res.status, message, hasServerMessage);
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

/**
 * Returns a user-facing message for a caught API error: the offline message when there's no
 * connectivity, the server's own explanation when it sent one (e.g. a validation error), or the
 * caller-supplied fallback otherwise.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof OfflineError) return err.message;
  if (err instanceof ApiError && err.hasServerMessage) return err.message;
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
