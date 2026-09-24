import type { FastifyPluginAsync } from 'fastify';

import { requirePermission } from '../auth/guards';
import {
  getComplianceOverview,
  getTenantCompliance,
  listGuardrailLibrary,
  listScpPolicies,
  listTenantGuardrails,
} from '../services/guardrail-service';

/**
 * Module 2 endpoints.
 *
 * Milestone 1 exposes the library, the per-tenant assignments, and the compliance
 * read model. Mutation endpoints (applying enforcement in a customer account) are
 * deliberately absent rather than stubbed with a fake success — assignment happens
 * through the onboarding governance step.
 */
export const guardrailRoutes: FastifyPluginAsync = async (app) => {
  const { prisma } = app.deps;

  app.get('/guardrails', async (request, reply) => {
    requirePermission(request, 'guardrail:read');
    return reply.send({ items: await listGuardrailLibrary(prisma) });
  });

  app.get('/guardrails/compliance', async (request, reply) => {
    requirePermission(request, 'guardrail:read');
    return reply.send(await getComplianceOverview(prisma));
  });

  app.get('/scp-policies', async (request, reply) => {
    requirePermission(request, 'guardrail:read');
    return reply.send({ items: await listScpPolicies(prisma) });
  });

  app.get('/tenants/:tenantId/guardrails', async (request, reply) => {
    requirePermission(request, 'guardrail:read');
    const { tenantId } = request.params as { tenantId: string };
    return reply.send({ items: await listTenantGuardrails(prisma, tenantId) });
  });

  app.get('/tenants/:tenantId/compliance', async (request, reply) => {
    requirePermission(request, 'guardrail:read');
    const { tenantId } = request.params as { tenantId: string };
    return reply.send(await getTenantCompliance(prisma, tenantId));
  });
};
