import { apiErrorSchema, type ApiErrorResponse } from '@whitehouse/shared';

/**
 * The single HTTP entry point for the console.
 *
 * Two things worth noting:
 *   - `credentials: 'include'` is required because the session cookie is
 *     cross-site in production (Vercel -> Render).
 *   - In development the base URL is empty, so requests go to the Vite dev proxy
 *     on the same origin, which keeps the cookie first-party while developing.
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const API_PREFIX = '/api/v1';

/**
 * Long enough to survive a Render free-tier cold start: the service sleeps after
 * 15 minutes idle and takes about a minute to answer its first request. Without a
 * timeout the request just hangs, which looks like a frozen sign-in button.
 */
export const REQUEST_TIMEOUT_MS = 60_000;

/** What the app will actually call — handy to show in the UI when debugging. */
export function getApiOrigin(): string {
  if (API_BASE_URL) return API_BASE_URL;
  return typeof window === 'undefined' ? '(same origin)' : window.location.origin;
}

export function isApiConfigured(): boolean {
  return API_BASE_URL.length > 0;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** True when the request never reached the server (offline, refused, timed out). */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

/**
 * Turns a low-level fetch failure into something an operator can act on.
 *
 * `fetch` rejects with a bare `TypeError: Failed to fetch` for a refused connection,
 * a DNS failure, a TLS problem, and a CORS rejection alike — four different problems
 * with four different fixes. Exported and pure so it is unit-testable.
 */
export function describeNetworkFailure(input: {
  requestUrl: string;
  configuredBaseUrl: string;
  pageOrigin: string;
  timedOut: boolean;
}): string {
  const { requestUrl, configuredBaseUrl, pageOrigin, timedOut } = input;

  let origin = configuredBaseUrl;
  if (!origin) {
    try {
      origin = new URL(requestUrl).origin;
    } catch {
      origin = requestUrl;
    }
  }

  if (timedOut) {
    return (
      `The API at ${origin} did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds. ` +
      'On Render\'s free tier the service sleeps after 15 minutes of inactivity and takes ' +
      'about a minute to wake — try again in a moment.'
    );
  }

  if (!configuredBaseUrl) {
    return (
      `Could not reach the API at ${origin}. VITE_API_BASE_URL is empty, so requests go to ` +
      'this page\'s own origin — start the API (npm run dev) or set VITE_API_BASE_URL to the ' +
      'API URL and restart the dev server.'
    );
  }

  return (
    `Could not reach the API at ${origin}. Check that the service is running and that its ` +
    `CORS_ORIGINS includes ${pageOrigin}, then reload.`
  );
}

function isTimeoutError(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  const name = (cause as { name?: unknown }).name;
  return name === 'TimeoutError' || name === 'AbortError';
}

export type QueryValue = string | number | boolean | undefined | null;

export function buildQueryString(query: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

export async function apiRequest<TResponse>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    query?: Record<string, QueryValue>;
    signal?: AbortSignal;
  } = {},
): Promise<TResponse> {
  const { method = 'GET', body, query, signal } = options;
  const url = `${API_BASE_URL}${API_PREFIX}${path}${query ? buildQueryString(query) : ''}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      describeNetworkFailure({
        requestUrl: url,
        configuredBaseUrl: API_BASE_URL,
        pageOrigin: typeof window === 'undefined' ? '(unknown)' : window.location.origin,
        timedOut: isTimeoutError(cause),
      }),
      cause,
    );
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  const text = await response.text();
  const payload: unknown = text.length > 0 ? safeJsonParse(text) : null;

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) {
      const error: ApiErrorResponse = parsed.data;
      throw new ApiError(
        response.status,
        error.error.code,
        error.error.message,
        error.error.details,
      );
    }
    throw new ApiError(
      response.status,
      'REQUEST_FAILED',
      `Request failed with status ${response.status}`,
    );
  }

  return payload as TResponse;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal) =>
    apiRequest<T>(path, { method: 'GET', query, signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

