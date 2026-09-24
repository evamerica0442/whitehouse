import { randomBytes } from 'node:crypto';

import {
  buildPaginationMeta,
  monthRange,
  type ComplianceState,
  type CreateTenantInput,
  type CrossAccountRef,
  type TenantListQuery,
  type TenantListResponse,
  type TenantSummary,
  type UpdateTenantInput,
} from '@whitehouse/shared';
import type { PrismaClient, Tenant } from '@whitehouse/db';

import { AppError } from '../lib/errors';
import { computeHealth, summarizeStates, type ComplianceCounts } from './health';

/** URL/stack-safe slug derived from the customer name. */
export function slugifyTenant(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'tenant'
  );
}

async function uniqueSlug(prisma: PrismaClient, name: string): Promise<string> {
  const base = slugifyTenant(name);
  let candidate = base;
  let suffix = 1;

  // Slugs appear in URLs and audit entries, so they stay stable and unique.
  while (await prisma.tenant.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

/**
 * The confused-deputy token embedded in the customer's CloudFormation trust
 * policy. Generated once per tenant and never reused or rotated silently —
 * rotating it requires the customer to redeploy the stack.
 */
export function generateExternalId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Builds the cross-account reference used for every AWS call against a tenant.
 *
 * Fails with a user-facing 409 rather than an AWS error when the tenant is not
 * far enough through onboarding to have an account ID and role ARN.
 */
export function buildCrossAccountRef(tenant: Tenant): CrossAccountRef {
  if (!tenant.awsAccountId || !tenant.roleArn) {
    throw AppError.tenantNotReady(
      `${tenant.customerName} is not ready for cross-account calls yet — the AWS account ID and role ARN must be captured first.`,
    );
  }

  return {
    tenantId: tenant.id,
    accountId: tenant.awsAccountId,
    roleArn: tenant.roleArn,
    externalId: tenant.externalId,
    region: tenant.region,
  };
}

export async function createTenant(
  prisma: PrismaClient,
  createdByUserId: string | null,
  input: CreateTenantInput,
): Promise<Tenant> {
  const slug = await uniqueSlug(prisma, input.customerName);

  return prisma.tenant.create({
    data: {
      slug,
      customerName: input.customerName,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail,
      environment: input.environment,
      region: input.region,
      awsAccountId: input.awsAccountId ?? null,
      notes: input.notes ?? null,
      externalId: generateExternalId(),
      status: 'NOT_STARTED',
      health: 'RED',
      createdByUserId,
    },
  });
}

export async function getTenantOrThrow(prisma: PrismaClient, tenantId: string): Promise<Tenant> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw AppError.notFound('Tenant');
  return tenant;
}

export async function updateTenant(
  prisma: PrismaClient,
  tenantId: string,
  input: UpdateTenantInput,
): Promise<Tenant> {
  await getTenantOrThrow(prisma, tenantId);

  return prisma.tenant.update({
    where: { id: tenantId },
    data: {
      ...(input.customerName === undefined ? {} : { customerName: input.customerName }),
      ...(input.contactName === undefined ? {} : { contactName: input.contactName }),
      ...(input.contactEmail === undefined ? {} : { contactEmail: input.contactEmail }),
      ...(input.environment === undefined ? {} : { environment: input.environment }),
      ...(input.region === undefined ? {} : { region: input.region }),
      ...(input.awsAccountId === undefined ? {} : { awsAccountId: input.awsAccountId }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    },
  });
}

interface TenantWithCounts extends Tenant {
  _count: { guardrails: number; deployments: number };
}

function buildWhere(query: TenantListQuery): Record<string, unknown> {
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.environment ? { environment: query.environment } : {}),
    ...(query.region ? { region: query.region } : {}),
    ...(query.search
      ? {
          OR: [
            { customerName: { contains: query.search, mode: 'insensitive' } },
            { contactEmail: { contains: query.search, mode: 'insensitive' } },
            { slug: { contains: query.search, mode: 'insensitive' } },
            { awsAccountId: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

/**
 * Spend is not a column, so it cannot be sorted in SQL. Rather than denormalise
 * it (a second source of truth for money), we fetch a bounded window and sort in
 * memory — fine for the tens-to-hundreds of tenants an MSP manages. If it ever
 * matters, add a materialised `tenants.month_to_date_usd` maintained by the
 * cost refresh job.
 */
const IN_MEMORY_SORT_LIMIT = 500;

function resolveOrderBy(
  sort: TenantListQuery['sort'],
  direction: TenantListQuery['direction'],
): Record<string, 'asc' | 'desc'> | null {
  switch (sort) {
    case 'customerName':
      return { customerName: direction };
    case 'status':
      return { status: direction };
    case 'monthlySpendUsd':
      return null;
    case 'createdAt':
    default:
      return { createdAt: direction };
  }
}

export function toTenantSummary(params: {
  tenant: TenantWithCounts;
  compliance: Pick<
    ComplianceCounts,
    'evaluated' | 'compliant' | 'nonCompliantCritical' | 'nonCompliantOther' | 'unknown'
  >;
  monthlySpendUsd: number | null;
  spendUpdatedAt: Date | null;
  delivery: {
    method: TenantSummary['deliveryMethod'];
    status: TenantSummary['deliveryStatus'];
    recipient: string | null;
    attemptedAt: Date | null;
    error: string | null;
  } | null;
}): TenantSummary {
  const { tenant, compliance, delivery } = params;

  return {
    id: tenant.id,
    slug: tenant.slug,
    customerName: tenant.customerName,
    contactName: tenant.contactName,
    contactEmail: tenant.contactEmail,
    environment: tenant.environment,
    region: tenant.region,
    status: tenant.status,
    awsAccountId: tenant.awsAccountId,
    roleArn: tenant.roleArn,
    externalId: tenant.externalId,
    deliveryMethod: delivery?.method ?? null,
    deliveryStatus: delivery?.status ?? 'NOT_SENT',
    deliveryRecipient: delivery?.recipient ?? null,
    deliveryAttemptedAt: delivery?.attemptedAt?.toISOString() ?? null,
    deliveryError: delivery?.error ?? null,
    guardrailCount: tenant._count.guardrails,
    templateCount: tenant._count.deployments,
    health: computeHealth({ status: tenant.status, ...compliance }),
    monthlySpendUsd: params.monthlySpendUsd,
    spendUpdatedAt: params.spendUpdatedAt?.toISOString() ?? null,
    lastVerifiedAt: tenant.lastVerifiedAt?.toISOString() ?? null,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
  };
}

export type { TenantWithCounts, ComplianceState };

/**
 * Loads the per-tenant aggregates for a page of tenants in three queries rather
 * than N+1: latest cost snapshot, guardrail states, and the latest delivery
 * attempt. Every one of these answers a question the tenant list shows.
 */
export async function enrichTenants(
  prisma: PrismaClient,
  rows: TenantWithCounts[],
  now = new Date(),
): Promise<TenantSummary[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const { startDate } = monthRange(now);
  const periodStart = new Date(`${startDate}T00:00:00.000Z`);

  const [snapshots, assignments, deliveries] = await Promise.all([
    prisma.costSnapshot.findMany({
      where: { tenantId: { in: ids }, granularity: 'DAILY', periodStart },
      orderBy: { fetchedAt: 'desc' },
    }),
    prisma.tenantGuardrail.findMany({
      where: { tenantId: { in: ids }, enabled: true },
      include: { guardrail: { select: { severity: true } } },
    }),
    prisma.onboardingDelivery.findMany({
      where: { tenantId: { in: ids } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const latestSnapshot = new Map<string, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) {
    if (!latestSnapshot.has(snapshot.tenantId)) latestSnapshot.set(snapshot.tenantId, snapshot);
  }

  const statesByTenant = new Map<string, { state: ComplianceState; severity: string }[]>();
  for (const assignment of assignments) {
    const list = statesByTenant.get(assignment.tenantId) ?? [];
    list.push({ state: assignment.state, severity: assignment.guardrail.severity });
    statesByTenant.set(assignment.tenantId, list);
  }

  const latestDelivery = new Map<string, (typeof deliveries)[number]>();
  for (const delivery of deliveries) {
    if (!latestDelivery.has(delivery.tenantId)) latestDelivery.set(delivery.tenantId, delivery);
  }

  return rows.map((tenant) => {
    const snapshot = latestSnapshot.get(tenant.id);
    const delivery = latestDelivery.get(tenant.id);

    return toTenantSummary({
      tenant,
      compliance: summarizeStates(statesByTenant.get(tenant.id) ?? []),
      monthlySpendUsd: snapshot ? Number(snapshot.total) : null,
      spendUpdatedAt: snapshot?.fetchedAt ?? null,
      delivery: delivery
        ? {
            method: delivery.method,
            status: delivery.status,
            recipient: delivery.recipient,
            attemptedAt: delivery.attemptedAt,
            error: delivery.error,
          }
        : null,
    });
  });
}

export async function listTenants(
  prisma: PrismaClient,
  query: TenantListQuery,
  now = new Date(),
): Promise<TenantListResponse> {
  const where = buildWhere(query);
  const total = await prisma.tenant.count({ where: where as never });
  const orderBy = resolveOrderBy(query.sort, query.direction);
  const skip = (query.page - 1) * query.pageSize;

  const include = { _count: { select: { guardrails: true, deployments: true } } } as const;

  // Two explicit calls rather than one spread: TypeScript cannot reconcile the
  // union of "paginated" and "sort-in-memory" argument shapes.
  const rows = orderBy
    ? await prisma.tenant.findMany({
        where: where as never,
        include,
        orderBy,
        skip,
        take: query.pageSize,
      })
    : await prisma.tenant.findMany({
        where: where as never,
        include,
        take: IN_MEMORY_SORT_LIMIT,
      });

  const summaries = await enrichTenants(prisma, rows, now);

  if (orderBy) {
    return { items: summaries, meta: buildPaginationMeta(query.page, query.pageSize, total) };
  }

  const sorted = [...summaries].sort((a, b) => {
    const diff = (a.monthlySpendUsd ?? 0) - (b.monthlySpendUsd ?? 0);
    return query.direction === 'asc' ? diff : -diff;
  });

  return {
    items: sorted.slice(skip, skip + query.pageSize),
    meta: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getTenantSummaryById(
  prisma: PrismaClient,
  tenantId: string,
  now = new Date(),
): Promise<TenantSummary> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { _count: { select: { guardrails: true, deployments: true } } },
  });
  if (!tenant) throw AppError.notFound('Tenant');

  const [summary] = await enrichTenants(prisma, [tenant], now);
  if (!summary) throw AppError.notFound('Tenant');
  return summary;
}


