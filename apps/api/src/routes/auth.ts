import {
  loginInputSchema,
  magicLinkConsumeSchema,
  magicLinkRequestSchema,
  type AuthSessionResponse,
} from '@whitehouse/shared';
import type { FastifyPluginAsync } from 'fastify';

import { verifyPassword } from '../auth/crypto';
import {
  buildMagicLinkEmail,
  consumeMagicLink,
  createMagicLink,
} from '../auth/magic-link-service';
import { requireSession } from '../auth/guards';
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  createSession,
  revokeSession,
} from '../auth/session-service';
import { AppError } from '../lib/errors';
import { writeAuditLog } from '../services/audit-service';

/**
 * Admin authentication.
 *
 * Both sign-in paths from the brief are implemented: email+password, and a
 * single-use magic link delivered by the configured EmailSender. Every success and
 * every failure is audited, because "who signed in" is the anchor for all the
 * cross-account actions logged elsewhere.
 */
export const authRoutes: FastifyPluginAsync = async (app) => {
  const { prisma, config, email, logger } = app.deps;

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = loginInputSchema.parse(request.body);

      const user = await prisma.user.findUnique({ where: { email: input.email } });
      const passwordMatches =
        user && user.isActive && user.passwordHash
          ? await verifyPassword(user.passwordHash, input.password)
          : false;

      if (!user || !passwordMatches) {
        await writeAuditLog(
          prisma,
          {
            action: 'USER_LOGIN_FAILED',
            outcome: 'FAILURE',
            actorEmail: input.email,
            ipAddress: request.ip,
            requestId: request.id,
            detail: { reason: user ? 'invalid_password' : 'unknown_user' },
          },
          logger,
        );
        throw AppError.unauthorized('Invalid email or password');
      }

      const { token, context } = await createSession(prisma, config, {
        userId: user.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

      const cookie = buildSessionCookie(config, token, context.expiresAt);
      reply.setCookie(cookie.name, cookie.value, cookie.options);

      await writeAuditLog(
        prisma,
        {
          action: 'USER_LOGIN',
          actorUserId: user.id,
          actorEmail: user.email,
          ipAddress: request.ip,
          requestId: request.id,
          detail: { method: 'password' },
        },
        logger,
      );

      const body: AuthSessionResponse = {
        user: context.user,
        expiresAt: context.expiresAt.toISOString(),
      };
      return reply.send(body);
    },
  );

  /**
   * Always 202: whether an account exists for the address is not disclosed — the
   * response is identical for known and unknown addresses.
   */
  app.post(
    '/auth/magic-link',
    { config: { rateLimit: { max: 5, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const input = magicLinkRequestSchema.parse(request.body);
      const result = await createMagicLink(prisma, config, input.email);

      if (result.created && result.token && result.recipient) {
        const message = buildMagicLinkEmail({
          config,
          token: result.token,
          recipientName: result.recipient,
          expiresMinutes: config.MAGIC_LINK_TTL_MINUTES,
        });
        await email.send({ ...message, to: result.recipient });
      }

      return reply.code(202).send({
        status: 'accepted',
        message: 'If that address belongs to an active admin, a sign-in link is on its way.',
      });
    },
  );

  app.post(
    '/auth/magic-link/consume',
    { config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const input = magicLinkConsumeSchema.parse(request.body);
      const consumed = await consumeMagicLink(prisma, config, input.token);

      if (!consumed) {
        await writeAuditLog(
          prisma,
          {
            action: 'USER_LOGIN_FAILED',
            outcome: 'FAILURE',
            ipAddress: request.ip,
            requestId: request.id,
            detail: { method: 'magic_link' },
          },
          logger,
        );
        throw new AppError(
          'INVALID_TOKEN',
          'That sign-in link is invalid, expired, or already used.',
          401,
        );
      }

      const { token, context } = await createSession(prisma, config, {
        userId: consumed.userId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      await prisma.user.update({
        where: { id: consumed.userId },
        data: { lastLoginAt: new Date() },
      });

      const cookie = buildSessionCookie(config, token, context.expiresAt);
      reply.setCookie(cookie.name, cookie.value, cookie.options);

      await writeAuditLog(
        prisma,
        {
          action: 'USER_LOGIN',
          actorUserId: context.user.id,
          actorEmail: context.user.email,
          ipAddress: request.ip,
          requestId: request.id,
          detail: { method: 'magic_link' },
        },
        logger,
      );

      const body: AuthSessionResponse = {
        user: context.user,
        expiresAt: context.expiresAt.toISOString(),
      };
      return reply.send(body);
    },
  );

  app.get('/auth/me', async (request, reply) => {
    const session = requireSession(request);
    const body: AuthSessionResponse = {
      user: session.user,
      expiresAt: session.expiresAt.toISOString(),
    };
    return reply.send(body);
  });

  app.post('/auth/logout', async (request, reply) => {
    const session = requireSession(request);
    const rawToken = request.cookies[config.SESSION_COOKIE_NAME];

    if (rawToken) {
      await revokeSession(prisma, config, rawToken);
    }

    const cleared = buildClearedSessionCookie(config);
    reply.clearCookie(cleared.name, cleared.options);

    await writeAuditLog(
      prisma,
      {
        action: 'USER_LOGOUT',
        actorUserId: session.user.id,
        actorEmail: session.user.email,
        ipAddress: request.ip,
        requestId: request.id,
      },
      logger,
    );

    return reply.send({ status: 'signed_out' });
  });
};
