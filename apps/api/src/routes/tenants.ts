import {
  assignGovernanceInputSchema,
  createTenantInputSchema,
  deliveryChoiceSchema,
  generateTemplateInputSchema,
  tenantListQuerySchema,
  testConnectionInputSchema,
  updateTenantInputSchema,
} from '@whitehouse/shared';
import type { FastifyPluginAsync } from 'fastify';

import { actorFrom, requirePermission } from '../auth/guards';
import { AppError } from '../lib/errors';
import { getTenantCostSummary } from '../services/cost-service';
import {
  assignGovernance,
  deliverTemplate,
  getOnboardingState,
  recordTemplateGenerated,
  verifyConnection,
} from '../services/onboarding-service';
import { writeAuditLog } from '../services/audit-service';
import {
  createTenant,
  getTenantSummaryById,
  listTenants,
  updateTenant,
} from '../services/tenant-service';

/**
 * Tenant management endpoints.
 *
 * Route handlers stay thin: parse with zod (the same contract the web app uses),
 * check a permission, delegate to a service, return a DTO. No Prisma query appears
 * in this file.
 */
export const tenantRoutes: FastifyPluginAsync = async (app) => {
  const { prisma, logger } = app.deps;

  app.get('/tenants', async (request, reply) => {
    requirePermission(request, 'tenant:read');
    const query = tenantListQuerySchema.parse(request.query);
    return reply.send(await listTenants(prisma, query));
  });

  app.post('/tenants', async (request, reply) => {
    const session = requirePermission(request, 'tenant:write');
    const input = createTenantInputSchema.parse(request.body);

    const tenant = await createTenant(prisma, session.user.id, input);

    await writeAuditLog(
      prisma,
      {
        action: 'TENANT_CREATED',
        ...actorFrom(request, session),
        tenantId: tenant.id,
        targetType: 'tenant',
        targetId: tenant.id,
        detail: {
          customerName: tenant.customerName,
          environment: tenant.environment,
          region: tenant.region,
        },
      },
      logger,
    );

    return reply.code(201).send(await getTenantSummaryById(prisma, tenant.id));
  });

  app.get('/tenants/:tenantId', async (request, reply) => {
    requirePermission(request, 'tenant:read');
    const { tenantId } = request.params as { tenantId: string };
    return reply.send(await getTenantSummaryById(prisma, tenantId));
  });

  app.patch('/tenants/:tenantId', async (request, reply) => {
    const session = requirePermission(request, 'tenant:write');
    const { tenantId } = request.params as { tenantId: string };
    const input = updateTenantInputSchema.parse(request.body);

    const tenant = await updateTenant(prisma, tenantId, input);

    await writeAuditLog(
      prisma,
      {
        action: 'TENANT_UPDATED',
        ...actorFrom(request, session),
        tenantId,
        targetType: 'tenant',
        targetId: tenantId,
        detail: { changed: Object.keys(input) },
      },
      logger,
    );

    return reply.send(await getTenantSummaryById(prisma, tenant.id));
  });

  app.get('/tenants/:tenantId/cost', async (request, reply) => {
    requirePermission(request, 'cost:read');
    const { tenantId } = request.params as { tenantId: string };
    return reply.send(await getTenantCostSummary(prisma, tenantId));
  });

  /**
   * Explicit, queued refresh. Cost Explorer bills per request, which is why this is
   * a deliberate admin action (plus a daily job) rather than something the
   * dashboard triggers on page load.
   */
  app.post('/tenants/:tenantId/cost/refresh', async (request, reply) => {
    const session = requirePermission(request, 'cost:refresh');
    const { tenantId } = request.params as { tenantId: string };

    const jobId = await app.deps.queue.enqueue(
      'cost.refresh-snapshot',
      { tenantId, requestedByUserId: session.user.id },
      { tenantId, requestedByUserId: session.user.id },
    );

    return reply.code(202).send({ status: 'queued', jobId });
  });

  // ---- Onboarding wizard ------------------------------------------------

  app.get('/tenants/:tenantId/onboarding', async (request, reply) => {
    requirePermission(request, 'tenant:read');
    const { tenantId } = request.params as { tenantId: string };
    return reply.send(await getOnboardingState(app.deps, tenantId));
  });

  app.post('/tenants/:tenantId/onboarding/template', async (request, reply) => {
    const session = requirePermission(request, 'onboarding:run');
    const { tenantId } = request.params as { tenantId: string };
    const input = generateTemplateInputSchema.parse(request.body ?? {});

    return reply.send(
      await recordTemplateGenerated(app.deps, tenantId, actorFrom(request, session), input),
    );
  });

  app.post('/tenants/:tenantId/onboarding/delivery', async (request, reply) => {
    const session = requirePermission(request, 'onboarding:run');
    const { tenantId } = request.params as { tenantId: string };
    const input = deliveryChoiceSchema.parse(request.body);

    const result = await deliverTemplate(app.deps, tenantId, input, actorFrom(request, session));

    return reply.send({
      deliveryId: result.deliveryId,
      method: result.method,
      status: result.status,
      recipient: result.recipient,
      providerMessageId: result.providerMessageId,
      error: result.error,
      tenantStatus: result.tenantStatus,
      template: result.template,
    });
  });

  app.post('/tenants/:tenantId/onboarding/verify', async (request, reply) => {
    const session = requirePermission(request, 'onboarding:run');
    const { tenantId } = request.params as { tenantId: string };
    const input = testConnectionInputSchema.parse(request.body);

    if (input.roleArn && !input.roleArn.startsWith('arn:aws:iam::')) {
      throw AppError.validation('roleArn must be a valid IAM role ARN (arn:aws:iam::...)');
    }

    return reply.send(
      await verifyConnection(app.deps, tenantId, input, actorFrom(request, session)),
    );
  });

  app.post('/tenants/:tenantId/onboarding/governance', async (request, reply) => {
    const session = requirePermission(request, 'onboarding:run');
    const { tenantId } = request.params as { tenantId: string };
    const input = assignGovernanceInputSchema.parse(request.body);

    const result = await assignGovernance(
      app.deps,
      tenantId,
      input,
      actorFrom(request, session),
    );

    // Prime the dashboard with spend data as soon as a tenant becomes active.
    if (result.status === 'ACTIVE') {
      await app.deps.queue.enqueue(
        'cost.refresh-snapshot',
        { tenantId, requestedByUserId: session.user.id },
        { tenantId, requestedByUserId: session.user.id },
      );
    }

    return reply.send(result);
  });
};
