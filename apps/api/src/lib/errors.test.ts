import { describe, expect, it } from 'vitest';

import { AppError, describeError, toErrorResponse } from './errors';

/**
 * The driver-adapter failure mode being covered here is real, not hypothetical:
 * a failed Neon connection throws an `ErrorEvent` whose `message` is empty, so a
 * naive `error.message` handler reports "unknown error" on the readiness probe —
 * the one response an operator needs to be informative.
 */
describe('describeError', () => {
  it('reports a plain Error with its name', () => {
    expect(describeError(new TypeError('fetch failed'))).toBe('TypeError: fetch failed');
  });

  it('walks the ErrorEvent -> Error chain the Neon driver produces', () => {
    const event = { type: 'error', error: new TypeError('') };

    expect(describeError(event)).toBe('error -> TypeError (no message)');
  });

  it('follows the cause chain of a wrapped error', () => {
    const root = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    const wrapped = new Error('database unreachable', { cause: root });

    expect(describeError(wrapped)).toBe(
      'Error: database unreachable -> Error: connect ECONNREFUSED 127.0.0.1:5432',
    );
  });

  it('surfaces a Prisma-style code and message from an object', () => {
    expect(describeError({ code: 'P1001', message: "Can't reach database server" })).toBe(
      'P1001 Can\'t reach database server',
    );
  });

  it('falls back to the object keys rather than saying nothing', () => {
    expect(describeError({ clientVersion: '7.10.0' })).toBe('object(clientVersion)');
  });

  it('handles non-object throws and cycles without looping forever', () => {
    expect(describeError('boom')).toBe('boom');
    expect(describeError(undefined)).toBe('unrecognised error (see server logs)');

    const cyclic: { message?: string; cause?: unknown } = { message: 'first' };
    cyclic.cause = cyclic;
    expect(describeError(cyclic)).toBe('first');
  });
});

describe('toErrorResponse', () => {
  it('passes through an AppError status, code and message', () => {
    const response = toErrorResponse(AppError.notFound('Tenant'));

    expect(response.statusCode).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toBe('Tenant not found');
  });

  it('hides internal detail behind a generic 500', () => {
    const response = toErrorResponse(new Error('connection string leaked here'));

    expect(response.statusCode).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body.error.message).toBe('Unexpected server error');
  });

  it('never exposes a non-AppError message', () => {
    const response = toErrorResponse(new Error('secret-bearing message'));
    expect(JSON.stringify(response.body)).not.toContain('secret-bearing');
  });
});
