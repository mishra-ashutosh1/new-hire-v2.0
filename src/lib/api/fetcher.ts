/**
 * Shared JSON fetcher for BFF routes.
 *
 * The BFF already returns a structured `{ error: { code, message, details } }`
 * body explaining exactly what failed and why — "Employee roster is unreachable
 * and no cached copy is available" versus a bare "HTTP 502".
 *
 * Discarding that body and throwing a status string throws away the only part
 * the user can act on. The distinction between "the roster is unreachable" (a
 * configuration problem, retry later) and "audit logging is unavailable" (a
 * compliance problem, escalate now) is invisible if both render as "502".
 */

export interface BffErrorBody {
  error?: { code?: string; message?: string; details?: string };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "UNKNOWN") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);

  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    let message = `Request failed with HTTP ${response.status}`;

    try {
      const body = (await response.json()) as BffErrorBody;
      if (body.error?.message) message = body.error.message;
      if (body.error?.code) code = body.error.code;
    } catch {
      // A non-JSON error body (a proxy page, an empty 502) leaves the default
      // message, which is still more honest than nothing.
    }

    throw new ApiError(message, response.status, code);
  }

  return (await response.json()) as T;
}
