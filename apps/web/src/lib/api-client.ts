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

  const response = await fetch(url, {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });

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
