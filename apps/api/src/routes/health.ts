import type { FastifyPluginAsync } from 'fastify';

/**
 * Liveness and readiness.
 *
 * `/healthz` is for Render (and any load balancer): it only reports that the
 * process is up. `/readyz` additionally probes Postgres, because a web service that
 * cannot reach Neon is not ready to take traffic — and on the free tier Neon
 * suspends idle computes, so this check is genuinely useful during a cold start.
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/healthz', async () => ({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    cloudProvider: app.deps.cloud.id,
    jobDriver: app.deps.queue.driver,
    emailDriver: app.deps.email.driver,
    nodeEnv: app.deps.config.NODE_ENV,
    timestamp: new Date().toISOString(),
  }));

  app.get('/readyz', async (_request, reply) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await app.deps.prisma.$queryRaw`SELECT 1`;
      checks.database = { ok: true };
    } catch (error) {
      checks.database = {
        ok: false,
        detail: error instanceof Error ? error.message : 'unknown database error',
      };
    }

    const ok = Object.values(checks).every((check) => check.ok);
    return reply.code(ok ? 200 : 503).send({
      status: ok ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });
};
