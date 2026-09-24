import {
  type ComplianceSummary,
  type GuardrailDefinition,
  type TenantGuardrailAssignment,
  type HealthIndicator,
  healthIndicatorSchema,
} from '@whitehouse/shared';
import type { PrismaClient } from '@whitehouse/db';

import { computeHealth, compliancePercent, summarizeStates } from './health';
import { getTenantOrThrow } from './tenant-service';

/**
 * Module 2 — guardrail library and per-tenant assignments.
 *
 * Milestone 1 scope: the catalog, the assignments, and the compliance read model
 * are real; enforcement (applying SCPs/Config rules in the customer account) and
 * scheduled drift detection land in Milestone 2, which is why assignments start in
 * the UNKNOWN state rather than a fabricated COMPLIANT.
 */

export async function listGuardrailLibrary(prisma: PrismaClient): Promise<GuardrailDefinition[]> {
  const guardrails = await prisma.guardrail.findMany({
    where: { isActive: true },
    orderBy: [{ category: 'asc' }, { severity: 'asc' }, { name: 'asc' }],
  });

  return guardrails.map((guardrail) => ({
    key: guardrail.key,
    name: guardrail.name,
    description: guardrail.description,
    category: guardrail.category,
    severity: guardrail.severity,
    controlTowerControlId: guardrail.controlTowerControlId,
    enforcement: guardrail.enforcement,
    isPrebuilt: guardrail.isPrebuilt,
  }));
}

export interface ScpPolicySummary {
  id: string;
  name: string;
  description: string;
  isPrebuilt: boolean;
}

/** SCP policies available for attachment during onboarding. */
export async function listScpPolicies(prisma: PrismaClient): Promise<ScpPolicySummary[]> {
  const policies = await prisma.scpPolicy.findMany({ orderBy: { name: 'asc' } });

  return policies.map((policy) => ({
    id: policy.id,
    name: policy.name,
    description: policy.description,
    isPrebuilt: policy.isPrebuilt,
  }));
}

export async function listTenantGuardrails(
  prisma: PrismaClient,
  tenantId: string,
): Promise<TenantGuardrailAssignment[]> {
  const assignments = await prisma.tenantGuardrail.findMany({
    where: { tenantId },
    include: { guardrail: { select: { key: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return assignments.map((assignment) => ({
    id: assignment.id,
    tenantId: assignment.tenantId,
    guardrailKey: assignment.guardrail.key,
    enabled: assignment.enabled,
    state: assignment.state,
    lastCheckedAt: assignment.lastCheckedAt?.toISOString() ?? null,
    detail: assignment.detail,
    updatedAt: assignment.updatedAt.toISOString(),
  }));
}

export async function getTenantCompliance(
  prisma: PrismaClient,
  tenantId: string,
): Promise<ComplianceSummary> {
  const tenant = await getTenantOrThrow(prisma, tenantId);

  const assignments = await prisma.tenantGuardrail.findMany({
    where: { tenantId, enabled: true },
    select: { state: true, lastCheckedAt: true, guardrail: { select: { severity: true } } },
  });

  const counts = summarizeStates(
    assignments.map((assignment) => ({
      state: assignment.state,
      severity: assignment.guardrail.severity,
    })),
  );

  const lastCheckedAt = assignments
    .map((assignment) => assignment.lastCheckedAt)
    .filter((value): value is Date => value !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    tenantId,
    evaluated: counts.evaluated,
    compliant: counts.compliant,
    nonCompliant: counts.nonCompliantCritical + counts.nonCompliantOther,
    unknown: counts.unknown,
    compliancePercent: compliancePercent(counts),
    health: computeHealth({ status: tenant.status, ...counts }),
    lastCheckedAt: lastCheckedAt?.toISOString() ?? null,
  };
}

export async function getComplianceOverview(
  prisma: PrismaClient,
): Promise<{
  totals: {
    tenants: number;
    green: number;
    yellow: number;
    red: number;
    compliancePercent: number;
  };
  perTenant: ComplianceSummary[];
}> {
  const tenants = await prisma.tenant.findMany({ select: { id: true }, orderBy: { customerName: 'asc' } });

  const perTenant = await Promise.all(
    tenants.map((tenant) => getTenantCompliance(prisma, tenant.id)),
  );

  const healthCounts: Record<HealthIndicator, number> = { GREEN: 0, YELLOW: 0, RED: 0 };
  for (const summary of perTenant) {
    if (healthIndicatorSchema.safeParse(summary.health).success) {
      healthCounts[summary.health] += 1;
    }
  }

  const evaluated = perTenant.reduce((sum, summary) => sum + summary.evaluated, 0);
  const compliant = perTenant.reduce((sum, summary) => sum + summary.compliant, 0);

  return {
    totals: {
      tenants: perTenant.length,
      green: healthCounts.GREEN,
      yellow: healthCounts.YELLOW,
      red: healthCounts.RED,
      compliancePercent: compliancePercent({ evaluated, compliant }),
    },
    perTenant,
  };
}
