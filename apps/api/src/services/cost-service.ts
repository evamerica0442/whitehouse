import {
  COST_SNAPSHOT_MAX_AGE_HOURS,
  monthRange,
  previousMonthRange,
  roundCurrency,
  type CloudProvider,
} from '@whitehouse/shared';
import type { PrismaClient, Tenant } from '@whitehouse/db';

import { AppError } from '../lib/errors';
import { buildCrossAccountRef, getTenantOrThrow } from './tenant-service';

/**
 * Cost Explorer is billed per API request, so:
 *   - `refreshCostSnapshot` runs only from a queued job (daily, or on demand);
 *   - reads for the dashboard/list always come from the `cost_snapshots` table.
 */

export interface RefreshCostResult {
  tenantId: string;
  total: number;
  currency: string;
  source: 'COST_EXPLORER' | 'MOCK';
  fetchedAt: string;
}

export interface CostDependencies {
  prisma: PrismaClient;
  cloud: CloudProvider;
}

export async function refreshCostSnapshot(
  deps: CostDependencies,
  tenantId: string,
  now = new Date(),
): Promise<RefreshCostResult> {
  const tenant = await getTenantOrThrow(deps.prisma, tenantId);
  const ref = buildCrossAccountRef(tenant);
  const { startDate, endDate } = monthRange(now);

  const breakdown = await deps.cloud.getCostAndUsage(ref, {
    startDate,
    endDate,
    granularity: 'DAILY',
  });

  const periodStart = new Date(`${startDate}T00:00:00.000Z`);
  const periodEnd = new Date(`${endDate}T00:00:00.000Z`);
  const source = deps.cloud.id === 'aws' ? 'COST_EXPLORER' : 'MOCK';

  await deps.prisma.costSnapshot.upsert({
    where: {
      tenantId_periodStart_periodEnd_granularity: {
        tenantId,
        periodStart,
        periodEnd,
        granularity: 'DAILY',
      },
    },
    create: {
      tenantId,
      periodStart,
      periodEnd,
      granularity: 'DAILY',
      currency: breakdown.currency,
      total: breakdown.total,
      byService: breakdown.byService as never,
      byDay: breakdown.byDay as never,
      source,
      fetchedAt: new Date(breakdown.fetchedAt),
    },
    update: {
      currency: breakdown.currency,
      total: breakdown.total,
      byService: breakdown.byService as never,
      byDay: breakdown.byDay as never,
      source,
      fetchedAt: new Date(breakdown.fetchedAt),
    },
  });

  return {
    tenantId,
    total: breakdown.total,
    currency: breakdown.currency,
    source,
    fetchedAt: breakdown.fetchedAt,
  };
}

export interface TenantCostSummary {
  tenantId: string;
  currency: string;
  monthToDateUsd: number;
  previousMonthUsd: number | null;
  byService: { service: string; amount: number }[];
  byDay: { date: string; amount: number }[];
  source: string | null;
  fetchedAt: string | null;
  isStale: boolean;
}

export function isSnapshotStale(fetchedAt: Date | null, now = new Date()): boolean {
  if (!fetchedAt) return true;
  const ageHours = (now.getTime() - fetchedAt.getTime()) / 3_600_000;
  return ageHours > COST_SNAPSHOT_MAX_AGE_HOURS;
}

export async function getTenantCostSummary(
  prisma: PrismaClient,
  tenantId: string,
  now = new Date(),
): Promise<TenantCostSummary> {
  const current = monthRange(now);
  const previous = previousMonthRange(now);

  const snapshots = await prisma.costSnapshot.findMany({
    where: {
      tenantId,
      granularity: 'DAILY',
      periodStart: { in: [new Date(`${current.startDate}T00:00:00.000Z`), new Date(`${previous.startDate}T00:00:00.000Z`)] },
    },
    orderBy: { fetchedAt: 'desc' },
  });

  const currentSnapshot = snapshots.find((snapshot) => snapshot.granularity === 'DAILY' && snapshot.periodStart.toISOString().startsWith(current.startDate));
  const previousSnapshot = snapshots.find((snapshot) => snapshot.periodStart.toISOString().startsWith(previous.startDate));

  if (!currentSnapshot) {
    return {
      tenantId,
      currency: 'USD',
      monthToDateUsd: 0,
      previousMonthUsd: null,
      byService: [],
      byDay: [],
      source: null,
      fetchedAt: null,
      isStale: true,
    };
  }

  return {
    tenantId,
    currency: currentSnapshot.currency,
    monthToDateUsd: Number(currentSnapshot.total),
    previousMonthUsd: previousSnapshot ? Number(previousSnapshot.total) : null,
    byService: (currentSnapshot.byService ?? []) as { service: string; amount: number }[],
    byDay: (currentSnapshot.byDay ?? []) as { date: string; amount: number }[],
    source: currentSnapshot.source,
    fetchedAt: currentSnapshot.fetchedAt.toISOString(),
    isStale: isSnapshotStale(currentSnapshot.fetchedAt, now),
  };
}

/** MSP-wide spend, straight from the snapshot cache. */
export async function getAggregateSpend(
  prisma: PrismaClient,
  now = new Date(),
): Promise<{ currency: string; monthToDateUsd: number; byTenant: Map<string, number>; lastRefreshedAt: Date | null }> {
  const { startDate } = monthRange(now);

  const snapshots = await prisma.costSnapshot.findMany({
    where: {
      granularity: 'DAILY',
      periodStart: new Date(`${startDate}T00:00:00.000Z`),
    },
    orderBy: { fetchedAt: 'desc' },
  });

  const byTenant = new Map<string, number>();
  let lastRefreshedAt: Date | null = null;

  for (const snapshot of snapshots) {
    // First row per tenant wins: ordered by fetchedAt desc.
    if (!byTenant.has(snapshot.tenantId)) {
      byTenant.set(snapshot.tenantId, Number(snapshot.total));
    }
    if (!lastRefreshedAt || snapshot.fetchedAt > lastRefreshedAt) {
      lastRefreshedAt = snapshot.fetchedAt;
    }
  }

  const monthToDateUsd = roundCurrency(
    [...byTenant.values()].reduce((sum, value) => sum + value, 0),
  );

  return { currency: 'USD', monthToDateUsd, byTenant, lastRefreshedAt };
}

export async function assertTenantReadiness(
  prisma: PrismaClient,
  tenantId: string,
): Promise<Tenant> {
  const tenant = await getTenantOrThrow(prisma, tenantId);
  if (tenant.status === 'NOT_STARTED') {
    throw AppError.tenantNotReady(
      `${tenant.customerName} has not been onboarded yet — generate and deliver the access template first.`,
    );
  }
  return tenant;
}
