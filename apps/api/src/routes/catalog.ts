import { TEMPLATE_STATUSES } from '@whitehouse/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { requirePermission } from '../auth/guards';
import { AppError } from '../lib/errors';
import {
  listCatalogTemplates,
  listTemplateVersions,
  listTenantDeployments,
  listTenantTemplateAccess,
} from '../services/catalog-service';

const catalogQuerySchema = z.object({
  status: z.enum(TEMPLATE_STATUSES).optional(),
});

const deployRequestSchema = z.object({
  templateKey: z.string().min(1).max(120),
  version: z.string().max(40).nullable().optional(),
  stackName: z.string().min(1).max(128),
  parameters: z.record(z.string(), z.string()).default({}),
});

/**
 * Module 3 endpoints.
 *
 * The catalog, versioning, approvals and entitlements are real. Deploying is wired
 * through the queue but the handler records the request as a FAILED deployment with
 * an explicit "Milestone 2" message — no handler pretends to have provisioned
 * anything in a customer account.
 */
export const catalogRoutes: FastifyPluginAsync = async (app) => {
  const { prisma } = app.deps;

  app.get('/catalog/templates', async (request, reply) => {
    requirePermission(request, 'template:read');
    const query = catalogQuerySchema.parse(request.query);
    return reply.send({
      items: await listCatalogTemplates(prisma, query.status ? { status: query.status } : {}),
    });
  });

  app.get('/catalog/templates/:templateKey/versions', async (request, reply) => {
    requirePermission(request, 'template:read');
    const { templateKey } = request.params as { templateKey: string };
    return reply.send({ items: await listTemplateVersions(prisma, templateKey) });
  });

  app.get('/tenants/:tenantId/catalog', async (request, reply) => {
    requirePermission(request, 'template:read');
    const { tenantId } = request.params as { tenantId: string };

    const [access, deployments] = await Promise.all([
      listTenantTemplateAccess(prisma, tenantId),
      listTenantDeployments(prisma, tenantId),
    ]);

    return reply.send({ access, deployments });
  });

  app.post('/tenants/:tenantId/catalog/deploy', async (request, reply) => {
    const session = requirePermission(request, 'template:deploy');
    const { tenantId } = request.params as { tenantId: string };
    const input = deployRequestSchema.parse(request.body);

    const access = await prisma.tenantTemplateAccess.findFirst({
      where: { tenantId, template: { key: input.templateKey } },
    });

    if (!access) {
      throw AppError.forbidden(
        `${input.templateKey} has not been granted to this tenant. Assign catalog access first.`,
      );
    }

    const jobId = await app.deps.queue.enqueue(
      'catalog.deploy-template',
      {
        tenantId,
        templateKey: input.templateKey,
        version: input.version ?? null,
        stackName: input.stackName,
        parameters: input.parameters,
        requestedByUserId: session.user.id,
      },
      { tenantId, requestedByUserId: session.user.id },
    );

    return reply.code(202).send({
      status: 'queued',
      jobId,
      note: 'Automated provisioning is Milestone 2 scope — the request is recorded, not executed.',
    });
  });
};
