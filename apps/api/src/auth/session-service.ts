import type { AdminRole, SessionUser } from '@whitehouse/shared';
import type { PrismaClient } from '@whitehouse/db';

import type { AppConfig } from '../config/env';
import { generateOpaqueToken, hashToken } from './crypto';

/**
 * Opaque, database-backed sessions.
 *
 * Deliberately first-party rather than a library: this is the pattern Lucia's
 * author now recommends in place of the deprecated package, it keeps the session
 * model under our control, and the whole surface the eventual IAM Identity
 * Center swap has to satisfy is `resolveSession` plus the two cookie helpers.
 *
 * The cookie carries a random token; only its keyed HMAC digest is stored, so a
 * database leak cannot be replayed.
 */

export interface SessionContext {
  sessionId: string;
  user: SessionUser;
  expiresAt: Date;
}

interface SessionUserRow {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  lastLoginAt: Date | null;
}

export function toSessionUser(row: SessionUserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}

export interface CreateSessionInput {
  userId: string;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
}

export interface CreatedSession {
  token: string;
  context: SessionContext;
}

export async function createSession(
  prisma: PrismaClient,
  config: AppConfig,
  input: CreateSessionInput,
): Promise<CreatedSession> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 60 * 60 * 1000);

  const session = await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashToken(token, config.SESSION_SECRET),
      expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
    include: { user: true },
  });

  return {
    token,
    context: {
      sessionId: session.id,
      user: toSessionUser(session.user),
      expiresAt,
    },
  };
}

export async function resolveSession(
  prisma: PrismaClient,
  config: AppConfig,
  token: string,
): Promise<SessionContext | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token, config.SESSION_SECRET) },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  if (!session.user.isActive) {
    return null;
  }

  // Best-effort activity tracking; failing this must never block a request.
  void prisma.session
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);

  return {
    sessionId: session.id,
    user: toSessionUser(session.user),
    expiresAt: session.expiresAt,
  };
}

export async function revokeSession(
  prisma: PrismaClient,
  config: AppConfig,
  token: string,
): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token, config.SESSION_SECRET), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessionsForUser(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  expires?: Date;
  maxAge?: number;
}

export function buildSessionCookie(
  config: AppConfig,
  token: string,
  expiresAt: Date,
): { name: string; value: string; options: CookieOptions } {
  return {
    name: config.SESSION_COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      secure: config.sessionCookieSecure,
      sameSite: config.SESSION_COOKIE_SAME_SITE,
      path: '/',
      expires: expiresAt,
      maxAge: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    },
  };
}

export function buildClearedSessionCookie(config: AppConfig): {
  name: string;
  value: string;
  options: CookieOptions;
} {
  return {
    name: config.SESSION_COOKIE_NAME,
    value: '',
    options: {
      httpOnly: true,
      secure: config.sessionCookieSecure,
      sameSite: config.SESSION_COOKIE_SAME_SITE,
      path: '/',
      maxAge: 0,
    },
  };
}
