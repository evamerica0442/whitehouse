import type { FastifyRequest } from 'fastify';

import { AppError } from '../lib/errors';
import { canPerform, type Permission } from './rbac';
import type { SessionContext } from './session-service';

/**
 * Route guards as plain functions rather than a decorator-based DSL.
 *
 * TypeScript can infer the return value, so handlers write
 * `const actor = requirePermission(request, 'tenant:write')` and get a non-null
 * session instead of a `session?.user` chain — while still failing closed.
 */

export function requireSession(request: FastifyRequest): SessionContext {
  if (!request.session) {
    throw AppError.unauthorized();
  }
  return request.session;
}

export function requirePermission(request: FastifyRequest, permission: Permission): SessionContext {
  const session = requireSession(request);

  if (!canPerform(session.user.role, permission)) {
    throw AppError.forbidden(
      `Role ${session.user.role} is not permitted to perform "${permission}"`,
    );
  }

  return session;
}

export interface RequestActor {
  userId: string | null;
  email: string | null;
  ipAddress: string | null;
  requestId: string | null;
}

/** Actor context for audit entries — never includes the session token. */
export function actorFrom(request: FastifyRequest, session?: SessionContext | null): RequestActor {
  return {
    userId: session?.user.id ?? null,
    email: session?.user.email ?? null,
    ipAddress: request.ip ?? null,
    requestId: typeof request.id === 'string' ? request.id : null,
  };
}

/** Anonymous actor, used by login attempts so failures are still auditable. */
export function anonymousActor(request: FastifyRequest): RequestActor {
  return {
    userId: null,
    email: null,
    ipAddress: request.ip ?? null,
    requestId: typeof request.id === 'string' ? request.id : null,
  };
}
