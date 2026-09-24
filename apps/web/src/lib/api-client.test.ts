import { describe, expect, it } from 'vitest';

import { describeNetworkFailure, REQUEST_TIMEOUT_MS } from './api-client';

/**
 * These messages are the whole point of the helper: `fetch` rejects with a bare
 * "Failed to fetch" for a refused connection, a DNS failure and a CORS rejection
 * alike, which tells an operator nothing about what to fix.
 */
describe('describeNetworkFailure', () => {
  const base = {
    requestUrl: 'http://localhost:5173/api/v1/auth/login',
    configuredBaseUrl: '',
    pageOrigin: 'http://localhost:5173',
    timedOut: false,
  };

  it('names the cold-start window on a timeout', () => {
    const message = describeNetworkFailure({ ...base, timedOut: true });

    expect(message).toContain('did not respond within 60 seconds');
    expect(message).toContain('free tier');
    expect(REQUEST_TIMEOUT_MS).toBe(60_000);
  });

  it('blames the missing VITE_API_BASE_URL when nothing is configured', () => {
    const message = describeNetworkFailure(base);

    expect(message).toContain('Could not reach the API at http://localhost:5173');
    expect(message).toContain('VITE_API_BASE_URL is empty');
    expect(message).toContain('npm run dev');
  });

  it('mentions CORS and the page origin when a base URL is configured', () => {
    const message = describeNetworkFailure({
      ...base,
      configuredBaseUrl: 'https://wh-api.onrender.com',
      pageOrigin: 'https://wh-web.vercel.app',
    });

    expect(message).toContain('https://wh-api.onrender.com');
    expect(message).toContain('CORS_ORIGINS includes https://wh-web.vercel.app');
  });

  it('prefers the configured base URL over the request URL for the origin', () => {
    const message = describeNetworkFailure({
      ...base,
      configuredBaseUrl: 'https://wh-api.onrender.com',
    });

    expect(message).toContain('https://wh-api.onrender.com');
    expect(message).not.toContain('localhost:5173/api/v1');
  });

  it('degrades gracefully when the request URL cannot be parsed', () => {
    const message = describeNetworkFailure({ ...base, requestUrl: 'not a url' });
    expect(message).toContain('not a url');
  });
});
