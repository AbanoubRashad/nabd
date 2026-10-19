/**
 * API access. Server components call the API directly (API_URL_INTERNAL inside Docker, otherwise the public
 * URL); the browser uses NEXT_PUBLIC_API_URL with cookies. Reads never throw: a page renders an "API
 * unreachable" state instead of crashing when the backend is down.
 */
export const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/ws';

function baseUrl(): string {
  return typeof window === 'undefined' ? (process.env.API_URL_INTERNAL ?? PUBLIC_API_URL) : PUBLIC_API_URL;
}

/** GET a JSON resource, or null if the API is unreachable or answers with an error. */
export async function apiGet<T>(path: string, timeoutMs = 3000): Promise<T | null> {
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      cache: 'no-store',
      credentials: 'include',
      signal: AbortSignal.timeout(timeoutMs),
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
