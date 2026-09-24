import {
  type DashboardSummary,
  type HealthIndicator,
  monthRange,
  previousMonthRange,
  roundCurrency,
  TENANT_STATUSES,
  type TenantStatus,
} from '@whitehouse/shared';
import type { PrismaClient } from '@whitehouse/db';

import { getAggregateSpend } from './cost-service';
import { compliancePercent, computeHealth, summarizeStates } from './health';

/**
 * Module 4: the single-pane-of-glass payload.
 *
 * Everything here is assembled from cached/local data — the only remotely
 * expensive source (Cost Explorer) is read from the snapshot table that the
 * scheduled refresh job maintains.
 */
export async function getDashboardSummary(
  prisma: PrismaClient,
  now = new Date(),
): Promise<DashboardSummary> {
  const [tenants, guardrailAssignments, spend] = await Promise.all([
    prisma.tenant.findMany({
      select: {
        id: true,
        customerName: true,
        status: true,
        health: true,
        region: true,
        lastVerifiedAt: true,
      },
    }),
    prisma.tenantGuardrail.findMany({
      where: { enabled: true },
      select: {
        tenantId: true,
        state: true,
        guardrail: { select: { severity: true } },
      },
    }),
    getAggregateSpend(prisma, now),
  ]);

  const statesByTenant = new Map<string, { state: (typeof guardrailAssignments)[number]['state']; severity: string }[]>();
  for (const assignment of guardrailAssignments) {
    const list = statesByTenant.get(assignment.tenantId) ?? [];
    list.push({ state: assignment.state, severity: assignment.guardrail.severity });
    statesByTenant.set(assignment.tenantId, list);
  }

  const byStatus = Object.fromEntries(
    TENANT_STATUSES.map((status) => [status, 0]),
  ) as Record<TenantStatus, number>;

  const healthCounts: Record<HealthIndicator, number> = { GREEN: 0, YELLOW: 0, RED: 0 };
  const alerts: DashboardSummary['alerts'] = [];
  const spendRows: DashboardSummary['spend']['byTenant'] = [];

  let evaluatedTotal = 0;
  let compliantTotal = 0;

  for (const tenant of tenants) {
    byStatus[tenant.status] += 1;

    const counts = summarizeStates(statesByTenant.get(tenant.id) ?? []);
    const health = computeHealth({ status: tenant.status, ...counts });
    healthCounts[health] += 1;

    evaluatedTotal += counts.evaluated;
    compliantTotal += counts.compliant;

    const tenantSpend = spend.byTenant.get(tenant.id) ?? 0;
    spendRows.push({
      tenantId: tenant.id,
      customerName: tenant.customerName,
      amountUsd: roundCurrency(tenantSpend),
      health,
    });

    if (tenant.status === 'AWAITING_VERIFICATION') {
      alerts.push({
        id: `awaiting-verification-${tenant.id}`,
        severity: 'INFO',
        title: 'Onboarding awaiting verification',
        detail: `${tenant.customerName} has a delivered template but access has not been verified.`,
        tenantId: tenant.id,
        createdAt: now.toISOString(),
      });
    }

    if (counts.nonCompliantCritical > 0) {
      alerts.push({
        id: `critical-drift-${tenant.id}`,
        severity: 'CRITICAL',
        title: 'Critical guardrail drift',
        detail: `${tenant.customerName} fails ${counts.nonCompliantCritical} high/critical control(s).`,
        tenantId: tenant.id,
        createdAt: now.toISOString(),
      });
    }

    if (tenant.status === 'ACTIVE' && !tenant.lastVerifiedAt) {
      alerts.push({
        id: `never-verified-${tenant.id}`,
        severity: 'WARNING',
        title: 'Active tenant never verified',
        detail: `${tenant.customerName} is active but has no successful connection test on record.`,
        tenantId: tenant.id,
        createdAt: now.toISOString(),
      });
    }
  }

  const previousMonth = previousMonthRange(now);
  const previousSnapshots = await prisma.costSnapshot.findMany({
    where: {
      granularity: 'DAILY',
      periodStart: new Date(`${previousMonth.startDate}T00:00:00.000Z`),
    },
    select: { total: true },
  });

  const previousMonthUsd =
    previousSnapshots.length === 0
      ? null
      : roundCurrency(previousSnapshots.reduce((sum, row) => sum + Number(row.total), 0));

  const currentMonthLabel = monthRange(now).startDate;

  return {
    accounts: {
      total: tenants.length,
      active: byStatus.ACTIVE,
      byStatus,
    },
    compliance: {
      percent: compliancePercent({ evaluated: evaluatedTotal, compliant: compliantTotal }),
      green: healthCounts.GREEN,
      yellow: healthCounts.YELLOW,
      red: healthCounts.RED,
    },
    spend: {
      monthToDateUsd: spend.monthToDateUsd,
      previousMonthUsd,
      currency: spend.currency,
      byTenant: spendRows.sort((a, b) => b.amountUsd - a.amountUsd),
      lastRefreshedAt: spend.lastRefreshedAt?.toISOString() ?? null,
    },
    onboarding: {
      notStarted: byStatus.NOT_STARTED,
      awaitingTemplate: byStatus.TEMPLATE_SENT,
      awaitingVerification: byStatus.AWAITING_VERIFICATION,
    },
    alerts,
    generatedAt: new Date(`${currentMonthLabel}T00:00:00.000Z`) > now ? now.toISOString() : now.toISOString(),
  };
}
