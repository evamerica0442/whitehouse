import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { hash as argon2Hash, verify as argon2Verify, Algorithm } from '@node-rs/argon2';

/**
 * Password hashing and opaque-token helpers.
 *
 * Argon2id via @node-rs/argon2: the prebuilt native binding keeps container
 * builds from needing a C toolchain (unlike the `argon2` package).
 */

// OWASP-recommended baseline for Argon2id (19 MiB, 2 iterations, 1 degree).
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return argon2Hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify(hash, password);
  } catch {
    // A malformed hash must read as "wrong password", never as a crash.
    return false;
  }
}

/** URL-safe random token for session cookies and magic links. */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Tokens are stored as HMAC-SHA256 digests keyed with SESSION_SECRET.
 * A stolen database dump therefore yields no usable sessions, and the keyed
 * digest means an attacker cannot precompute a rainbow table of tokens.
 */
export function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Deterministic short fingerprint for logs (never log a raw token). */
export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
