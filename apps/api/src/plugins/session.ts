import cookie from '@fastify/cookie';
import fp from 'fastify-plugin';

import { resolveSession } from '../auth/session-service';

/**
 * Resolves the session cookie once per request and hangs it off `request.session`.
 *
 * Registration order matters: the cookie plugin must be installed before this hook
 * runs, which is why both live in the same plugin.
 */
export const sessionPlugin = fp(async (app) => {
  await app.register(cookie, { secret: app.deps.config.SESSION_SECRET });

  app.decorateRequest('session', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[app.deps.config.SESSION_COOKIE_NAME];
    if (!token) {
      request.session = null;
      return;
    }

    try {
      request.session = await resolveSession(app.deps.prisma, app.deps.config, token);
    } catch (error) {
      // A database blip must degrade to "logged out", not a 500 on every route.
      app.deps.logger.warn({ err: error }, 'session lookup failed');
      request.session = null;
    }
  });
});
