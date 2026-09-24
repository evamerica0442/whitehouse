import type { CloudProvider } from '@whitehouse/shared';
import type { PrismaClient } from '@whitehouse/db';

import type { AppConfig } from '../config/env';
import type { EmailSender } from '../email/email-sender';
import { refreshCostSnapshot } from '../services/cost-service';
import type { AppLogger } from '../services/onboarding-service';
import { getTenantOrThrow } from '../services/tenant-service';
import type { JobHandlerMap } from './queue';

export interface JobHandlerDependencies {
  prisma: PrismaClient;
  config: AppConfig;
  cloud: CloudProvider;
  email: EmailSender;
  logger: AppLogger;
}

/**
 * The job registry.
 *
 * Handlers are thin wrappers over services, so the same code path can be exercised
 * from a test, an HTTP request, or a scheduled trigger — and so retrying a job
 * never depends on queue-specific idempotency tricks.
 */
export function createJobHandlers(deps: JobHandlerDependencies): JobHandlerMap {
  // Annotating the literal (rather than asserting on return) makes TypeScript infer
  // every handler's payload from JobPayloadMap, so renaming a field becomes a
  // compile error instead of a runtime surprise.
  const handlers: JobHandlerMap = {
    'cost.refresh-snapshot': async (payload) => {
      if (payload.tenantId) {
        return { refreshed: [await refreshCostSnapshot(deps, payload.tenantId)] };
      }

      // No tenant specified: refresh every onboarded tenant. Runs from the daily
      // scheduler, so it must tolerate individual failures instead of aborting.
      const tenants = await deps.prisma.tenant.findMany({
        where: { status: 'ACTIVE', awsAccountId: { not: null }, roleArn: { not: null } },
        select: { id: true, customerName: true },
      });

      const refreshed: unknown[] = [];
      const failed: { tenantId: string; error: string }[] = [];

      for (const tenant of tenants) {
        try {
          refreshed.push(await refreshCostSnapshot(deps, tenant.id));
        } catch (error) {
          failed.push({
            tenantId: tenant.id,
            error: error instanceof Error ? error.message : String(error),
          });
          deps.logger.warn(
            { err: error, tenantId: tenant.id, customerName: tenant.customerName },
            'cost refresh failed for tenant',
          );
        }
      }

      return { refreshedCount: refreshed.length, failed };
    },

    'tenant.verify-connection': async (payload) => {
      const tenant = await getTenantOrThrow(deps.prisma, payload.tenantId);
      if (!tenant.awsAccountId || !tenant.roleArn) {
        return { skipped: true, reason: 'Tenant has no account ID or role ARN yet' };
      }

      const { verifyConnection } = await import('../services/onboarding-service');
      return verifyConnection(
        deps,
        payload.tenantId,
        {
          awsAccountId: tenant.awsAccountId,
          roleArn: tenant.roleArn,
        },
        { userId: payload.requestedByUserId, email: null },
      );
    },

    'tenant.apply-guardrails': async (payload) => {
      if (payload.guardrailKeys.length === 0 && payload.scpPolicyIds.length === 0) {
        return { skipped: true, reason: 'No guardrails or SCPs requested' };
      }

      const { assignGovernance } = await import('../services/onboarding-service');
      const result = await assignGovernance(
        deps,
        payload.tenantId,
        {
          guardrailKeys: payload.guardrailKeys,
          scpPolicyIds: payload.scpPolicyIds,
          templateKeys: [],
          activateTenant: false,
        },
        { userId: payload.requestedByUserId, email: null },
      );

      return {
        guardrailKeys: result.guardrailKeys,
        scpPolicyIds: result.scpPolicyIds,
        missingGuardrailKeys: result.missingGuardrailKeys,
        // Enforcement is Milestone 2: assignments are recorded now, and the
        // scheduled guardrail job evaluates them once the control plane exists.
        enforced: false,
      };
    },

    'guardrail.run-checks': async (payload) => {
      const tenantIds = payload.tenantId
        ? [payload.tenantId]
        : (
            await deps.prisma.tenant.findMany({
              where: { status: 'ACTIVE' },
              select: { id: true },
            })
          ).map((tenant) => tenant.id);

      let evaluated = 0;

      for (const tenantId of tenantIds) {
        const assignments = await deps.prisma.tenantGuardrail.findMany({
          where: {
            tenantId,
            enabled: true,
            ...(payload.guardrailKeys.length > 0
              ? { guardrail: { key: { in: payload.guardrailKeys } } }
              : {}),
          },
          select: { id: true, state: true },
        });

        for (const assignment of assignments) {
          await deps.prisma.guardrailCheck.create({
            data: {
              tenantGuardrailId: assignment.id,
              state: assignment.state,
              detail:
                'Recorded by the scheduled drift check. Live evaluation against the customer account is Milestone 2 scope.',
              evaluatedBy: 'scheduler',
            },
          });
          await deps.prisma.tenantGuardrail.update({
            where: { id: assignment.id },
            data: { lastCheckedAt: new Date() },
          });
          evaluated += 1;
        }
      }

      return { tenants: tenantIds.length, evaluated };
    },

    'tenant.send-onboarding-email': async (payload) => {
      const { deliverTemplate } = await import('../services/onboarding-service');
      return deliverTemplate(
        deps,
        payload.tenantId,
        { method: 'AUTOMATED', recipientEmail: payload.recipient },
        { userId: payload.requestedByUserId, email: null },
      );
    },
    'catalog.deploy-template': async (payload) => {
      // Recorded, not executed. Provisioning into a customer account is Milestone
      // 2; a visible FAILED deployment row is better than a silent no-op that
      // looks like success.
      const template = await deps.prisma.catalogTemplate.findUnique({
        where: { key: payload.templateKey },
        include: { versions: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });

      const version = template?.versions[0];
      if (!template || !version) {
        return { ok: false, reason: `Template ${payload.templateKey} has no publishable version` };
      }

      await deps.prisma.templateDeployment.create({
        data: {
          tenantId: payload.tenantId,
          templateId: template.id,
          versionId: version.id,
          stackName: payload.stackName,
          parameters: payload.parameters as never,
          status: 'FAILED',
          message:
            'Deployment request recorded. Automated provisioning runs in Milestone 2 — nothing was created in the customer account.',
          deployedByUserId: payload.requestedByUserId,
        },
      });

      return { ok: false, reason: 'NOT_IMPLEMENTED_IN_MILESTONE_1' };
    },
  };

  return handlers;
}
