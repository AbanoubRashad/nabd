/**
 * API access. Server components call the API directly (API_URL_INTERNAL inside Docker, otherwise the public
 * URL); the browser uses NEXT_PUBLIC_API_URL with cookies. Reads never throw: a page renders an "API
 * unreachable" state instead of crashing when the backend is down.
 */
export const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/ws';
/**
 * Set NEXT_PUBLIC_API_URL to an empty string for a website-only deployment (no backend): nothing is
 * fetched, no WebSocket is opened, and the dashboard pages explain that the live backend is offline.
 */
export const API_ENABLED = PUBLIC_API_URL !== '';

function baseUrl(): string {
  return typeof window === 'undefined' ? (process.env.API_URL_INTERNAL ?? PUBLIC_API_URL) : PUBLIC_API_URL;
}

/**
 * GET a JSON resource, or null if the API is unreachable or answers with an error. `revalidate` (seconds)
 * lets the server cache a public response, which keeps the landing page fast; otherwise nothing is cached.
 */
export async function apiGet<T>(
  path: string,
  opts: { timeoutMs?: number; revalidate?: number } = {},
): Promise<T | null> {
  if (!API_ENABLED) return null;
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...(opts.revalidate === undefined
        ? { cache: 'no-store' as const }
        : { next: { revalidate: opts.revalidate } }),
      credentials: 'include',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Mutations from the browser. Every one carries the CSRF header the API requires. */
export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  if (!API_ENABLED) throw new ApiError(503, 'offline', 'The live backend for this demo is offline.');
  const res = await fetch(`${PUBLIC_API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: { 'x-nabd-csrf': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? 'error', json.message ?? `HTTP ${res.status}`);
  return json as T;
}
