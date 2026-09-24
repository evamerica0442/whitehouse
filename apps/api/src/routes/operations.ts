import {
  auditLogQuerySchema,
  buildPaginationMeta,
  type AuditLogResponse,
} from '@whitehouse/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { requirePermission } from '../auth/guards';
import { AppError } from '../lib/errors';
import { getDashboardSummary } from '../services/dashboard-service';

/**
 * Module 4 endpoints plus the scheduler hook.
 *
 * The scheduler endpoint exists because Render's free tier has no cron jobs or
 * background workers. A GitHub Actions schedule (free) calls it with a shared
 * secret, and the work is queued exactly as if an admin had clicked the button.
 */
export const operationsRoutes: FastifyPluginAsync = async (app) => {
  const { prisma, config, queue, logger } = app.deps;

  app.get('/dashboard/summary', async (request, reply) => {
    requirePermission(request, 'tenant:read');
    return reply.send(await getDashboardSummary(prisma));
  });

  app.get('/audit', async (request, reply) => {
    requirePermission(request, 'audit:read');
    const query = auditLogQuerySchema.parse(request.query);
    const skip = (query.page - 1) * query.pageSize;

    const where = {
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: where as never,
        include: {
          actor: { select: { email: true } },
          tenant: { select: { customerName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
      }),
      prisma.auditLog.count({ where: where as never }),
    ]);

    const body: AuditLogResponse = {
      items: rows.map((row) => ({
        id: row.id,
        actorUserId: row.actorUserId,
        actorEmail: row.actor?.email ?? row.actorEmail,
        tenantId: row.tenantId,
        tenantName: row.tenant?.customerName ?? null,
        action: row.action,
        outcome: row.outcome,
        targetType: row.targetType,
        targetId: row.targetId,
        detail: (row.detail ?? null) as Record<string, unknown> | null,
        ipAddress: row.ipAddress,
        requestId: row.requestId,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };

    return reply.send(body);
  });

  app.get('/jobs', async (request, reply) => {
    requirePermission(request, 'audit:read');
    const rows = await prisma.jobRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { tenant: { select: { customerName: true } } },
    });

    return reply.send({
      driver: queue.driver,
      items: rows.map((row) => ({
        id: row.id,
        jobName: row.jobName,
        queueJobId: row.queueJobId,
        tenantId: row.tenantId,
        tenantName: row.tenant?.customerName ?? null,
        status: row.status,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        error: row.error,
        startedAt: row.startedAt?.toISOString() ?? null,
        finishedAt: row.finishedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  });

  /** Manual trigger for the daily jobs — used by the dashboard's refresh button. */
  app.post('/jobs/run-daily', async (request, reply) => {
    const session = requirePermission(request, 'job:run');

    const [costJobId, guardrailJobId] = await Promise.all([
      queue.enqueue('cost.refresh-snapshot', {
        tenantId: null,
        requestedByUserId: session.user.id,
      }),
      queue.enqueue('guardrail.run-checks', { tenantId: null, guardrailKeys: [] }),
    ]);

    return reply.code(202).send({ status: 'queued', costJobId, guardrailJobId });
  });

  /**
   * Scheduler endpoint. Authenticated by a shared secret rather than a session,
   * because the caller is CI, not a person. Refuses to run at all when no secret is
   * configured, so an unset variable can never leave it open.
   */
  app.post('/internal/jobs/run-daily', async (request: FastifyRequest, reply) => {
    if (!config.INTERNAL_CRON_SECRET) {
      throw AppError.forbidden('Scheduler endpoint is disabled: INTERNAL_CRON_SECRET is not set');
    }

    const provided = request.headers['x-cron-secret'];
    if (typeof provided !== 'string' || provided !== config.INTERNAL_CRON_SECRET) {
      logger.warn({ ip: request.ip }, 'rejected scheduler request with bad secret');
      throw AppError.forbidden('Invalid scheduler secret');
    }

    const [costJobId, guardrailJobId] = await Promise.all([
      queue.enqueue('cost.refresh-snapshot', { tenantId: null, requestedByUserId: null }),
      queue.enqueue('guardrail.run-checks', { tenantId: null, guardrailKeys: [] }),
    ]);

    return reply.code(202).send({ status: 'queued', costJobId, guardrailJobId });
  });
};
