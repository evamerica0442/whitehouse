import {
  CROSS_ACCOUNT_ROLES,
  CloudProviderError,
  roundCurrency,
  toIsoDate,
  type AccountFacts,
  type AssumeRoleCheck,
  type CloudProvider,
  type CostBreakdown,
  type CostQuery,
  type CrossAccountRef,
  type PermissionProbe,
} from '@whitehouse/shared';

/**
 * Deterministic stand-in for AWS.
 *
 * Why this exists: the console runs on free-tier hosting and in CI with no
 * customer credentials, and the onboarding wizard must be demonstrable before a
 * real AWS Organizations management account exists. Values are derived from a
 * hash of the tenant's account ID, so the same tenant always shows the same
 * spend and latency — no flakiness in tests, no random numbers in demos.
 */

function hashToInt(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** Account IDs ending in 0000 simulate a role that was never created. */
function isBrokenAccount(accountId: string): boolean {
  return accountId.endsWith('0000') || accountId === '000000000000';
}

const MOCK_SERVICES = [
  { name: 'Amazon Elastic Compute Cloud - Compute', weight: 0.34 },
  { name: 'Amazon Relational Database Service', weight: 0.21 },
  { name: 'Amazon Simple Storage Service', weight: 0.14 },
  { name: 'AWS Lambda', weight: 0.09 },
  { name: 'Amazon CloudWatch', weight: 0.07 },
  { name: 'Amazon Elastic Container Service', weight: 0.08 },
  { name: 'AWS Key Management Service', weight: 0.03 },
  { name: 'Amazon Route 53', weight: 0.04 },
];

export class MockCloudProvider implements CloudProvider {
  readonly id = 'mock' as const;

  /** Latency the dashboard shows in the wizard so it feels like a real call. */
  constructor(private readonly simulatedLatencyMs = 120) {}

  private async delay(): Promise<void> {
    if (this.simulatedLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedLatencyMs));
    }
  }

  async verifyCrossAccountAccess(ref: CrossAccountRef): Promise<AssumeRoleCheck> {
    const startedAt = Date.now();
    await this.delay();

    if (ref.externalId.startsWith('invalid')) {
      return {
        ok: false,
        accountId: null,
        assumedRoleArn: null,
        callerIdentity: null,
        expiresAt: null,
        latencyMs: Date.now() - startedAt,
        errorCode: 'ASSUME_ROLE_ACCESS_DENIED',
        errorMessage:
          'Not authorized to perform sts:AssumeRole (mock: ExternalId does not match the trust policy)',
      };
    }

    if (isBrokenAccount(ref.accountId)) {
      return {
        ok: false,
        accountId: null,
        assumedRoleArn: null,
        callerIdentity: null,
        expiresAt: null,
        latencyMs: Date.now() - startedAt,
        errorCode: 'ASSUME_ROLE_ACCESS_DENIED',
        errorMessage: `Role ${CROSS_ACCOUNT_ROLES.readOnly} was not found in account ${ref.accountId} (mock)`,
      };
    }

    const sessionName = `whitehouse-${ref.tenantId.slice(0, 8)}`;

    return {
      ok: true,
      accountId: ref.accountId,
      assumedRoleArn: ref.roleArn,
      callerIdentity: `arn:aws:sts::${ref.accountId}:assumed-role/${CROSS_ACCOUNT_ROLES.readOnly}/${sessionName}`,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      latencyMs: Date.now() - startedAt,
      errorCode: null,
      errorMessage: null,
    };
  }

  async runPermissionProbes(ref: CrossAccountRef): Promise<PermissionProbe[]> {
    const broken = isBrokenAccount(ref.accountId);
    return [
      { name: 'sts:GetCallerIdentity', ok: !broken, detail: broken ? 'mock failure' : ref.roleArn },
      {
        name: 'organizations:DescribeAccount',
        ok: !broken,
        detail: broken ? 'mock failure' : `Account ${ref.accountId} (mock)`,
      },
      { name: 'ce:GetCostAndUsage', ok: !broken, detail: 'verified by scheduled job only (mock)' },
    ];
  }

  async getAccountFacts(ref: CrossAccountRef): Promise<AccountFacts> {
    await this.delay();
    if (isBrokenAccount(ref.accountId)) {
      throw new CloudProviderError(
        'ACCOUNT_FACTS_FAILED',
        `Mock account ${ref.accountId} is not reachable`,
        false,
      );
    }

    return {
      accountId: ref.accountId,
      accountName: `Mock account ${ref.accountId.slice(-4)}`,
      accountEmail: `aws+${ref.accountId}@example.com`,
      status: 'ACTIVE',
      joinedMethod: 'INVITED',
      organizationalUnitPath: 'root/Workloads',
    };
  }

  async getCostAndUsage(ref: CrossAccountRef, query: CostQuery): Promise<CostBreakdown> {
    await this.delay();

    const seed = hashToInt(ref.accountId);
    const monthlyBase = 900 + (seed % 5200);
    const start = new Date(`${query.startDate}T00:00:00.000Z`);
    const end = new Date(`${query.endDate}T00:00:00.000Z`);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    const dailyBase = monthlyBase / 30;

    const byDay: { date: string; amount: number }[] = [];
    let total = 0;

    for (let index = 0; index < days; index += 1) {
      const day = new Date(start.getTime() + index * 86_400_000);
      // Deterministic weekday shape: weekends cost less, with a small wobble.
      const weekday = day.getUTCDay();
      const weekendFactor = weekday === 0 || weekday === 6 ? 0.72 : 1;
      const wobble = 0.9 + ((hashToInt(`${ref.accountId}:${toIsoDate(day)}`) % 21) / 100);
      const amount = roundCurrency(dailyBase * weekendFactor * wobble);
      byDay.push({ date: toIsoDate(day), amount });
      total += amount;
    }

    const byService = MOCK_SERVICES.map((service) => ({
      service: service.name,
      amount: roundCurrency(total * service.weight),
    }));

    return {
      accountId: ref.accountId,
      currency: 'USD',
      total: roundCurrency(total),
      byService,
      byDay,
      fetchedAt: new Date().toISOString(),
    };
  }
}
