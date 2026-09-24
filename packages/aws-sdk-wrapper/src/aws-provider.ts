import { GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { DescribeAccountCommand } from '@aws-sdk/client-organizations';
import {
  CloudProviderError,
  roundCurrency,
  type AccountFacts,
  type AssumeRoleCheck,
  type CloudProvider,
  type CostBreakdown,
  type CostQuery,
  type CrossAccountRef,
  type PermissionProbe,
} from '@whitehouse/shared';

import {
  AssumeRoleClientFactory,
  createManagementStsClient,
  type AssumeRoleSessionProvider,
} from './clients';
import { StsAssumeRoleProvider } from './sts-assume-role-provider';

export interface AwsCloudProviderOptions {
  /** Injectable for tests; production uses the default STS-backed provider. */
  sessions?: AssumeRoleSessionProvider;
  factory?: AssumeRoleClientFactory;
}

/**
 * Live AWS implementation of CloudProvider.
 *
 * Nothing here runs inside an HTTP request except `verifyCrossAccountAccess`
 * (the wizard's explicit Test Connection). Cost reads are always invoked from a
 * background job, because Cost Explorer bills per API request.
 */
export class AwsCloudProvider implements CloudProvider {
  readonly id = 'aws' as const;

  private readonly sessions: AssumeRoleSessionProvider;
  private readonly factory: AssumeRoleClientFactory;

  constructor(options: AwsCloudProviderOptions = {}) {
    this.sessions = options.sessions ?? new StsAssumeRoleProvider(createManagementStsClient());
    this.factory = options.factory ?? new AssumeRoleClientFactory(this.sessions);
  }

  async verifyCrossAccountAccess(ref: CrossAccountRef): Promise<AssumeRoleCheck> {
    const startedAt = Date.now();

    try {
      // forceRefresh: the wizard must prove access *now*, never return a cache hit.
      const session = await this.sessions.assumeRole(ref, { forceRefresh: true });

      return {
        ok: true,
        accountId: session.accountId,
        assumedRoleArn: session.assumedRoleArn,
        callerIdentity: session.callerArn,
        expiresAt: session.expiration?.toISOString() ?? null,
        latencyMs: Date.now() - startedAt,
        errorCode: null,
        errorMessage: null,
      };
    } catch (error) {
      const mapped =
        error instanceof CloudProviderError
          ? error
          : new CloudProviderError('ASSUME_ROLE_UNKNOWN', (error as Error).message, false);

      return {
        ok: false,
        accountId: null,
        assumedRoleArn: null,
        callerIdentity: null,
        expiresAt: null,
        latencyMs: Date.now() - startedAt,
        errorCode: mapped.code,
        errorMessage: mapped.message,
      };
    }
  }

  /**
   * Cheap, free-to-call probes showing the customer *which* capabilities the
   * role actually grants. Deliberately excludes Cost Explorer (billed per call).
   */
  async runPermissionProbes(ref: CrossAccountRef): Promise<PermissionProbe[]> {
    const probes: PermissionProbe[] = [];

    try {
      const session = await this.sessions.assumeRole(ref);
      probes.push({ name: 'sts:GetCallerIdentity', ok: true, detail: session.callerArn });
    } catch (error) {
      probes.push({ name: 'sts:GetCallerIdentity', ok: false, detail: (error as Error).message });
      return probes;
    }

    try {
      const organizations = await this.factory.getOrganizationsClient(ref);
      const account = await organizations.send(
        new DescribeAccountCommand({ AccountId: ref.accountId }),
      );
      probes.push({
        name: 'organizations:DescribeAccount',
        ok: true,
        detail: account.Account?.Name ?? ref.accountId,
      });
    } catch (error) {
      probes.push({
        name: 'organizations:DescribeAccount',
        ok: false,
        detail: (error as Error).message,
      });
    }

    return probes;
  }

  async getAccountFacts(ref: CrossAccountRef): Promise<AccountFacts> {
    try {
      const organizations = await this.factory.getOrganizationsClient(ref);
      const account = await organizations.send(
        new DescribeAccountCommand({ AccountId: ref.accountId }),
      );

      return {
        accountId: ref.accountId,
        accountName: account.Account?.Name ?? null,
        accountEmail: account.Account?.Email ?? null,
        status: account.Account?.Status ?? null,
        joinedMethod: account.Account?.JoinedMethod ?? null,
        organizationalUnitPath: null,
      };
    } catch (error) {
      throw error instanceof CloudProviderError
        ? error
        : new CloudProviderError('ACCOUNT_FACTS_FAILED', (error as Error).message, true);
    }
  }

  async getCostAndUsage(ref: CrossAccountRef, query: CostQuery): Promise<CostBreakdown> {
    const client = await this.factory.getCostExplorerClient(ref);

    const response = await client.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: query.startDate, End: query.endDate },
        Granularity: query.granularity,
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      }),
    );

    const byDay: { date: string; amount: number }[] = [];
    const serviceTotals = new Map<string, number>();
    let total = 0;
    let currency = 'USD';

    for (const period of response.ResultsByTime ?? []) {
      const periodStart = period.TimePeriod?.Start;
      let periodTotal = 0;

      for (const group of period.Groups ?? []) {
        const service = group.Keys?.[0] ?? 'Unknown';
        const metric = group.Metrics?.UnblendedCost;
        const amount = Number(metric?.Amount ?? 0);
        if (metric?.Unit) currency = metric.Unit;

        periodTotal += amount;
        serviceTotals.set(service, (serviceTotals.get(service) ?? 0) + amount);
      }

      // `Total` is not always populated when grouping, so sum the groups instead.
      total += periodTotal;
      if (periodStart) {
        byDay.push({ date: periodStart, amount: roundCurrency(periodTotal) });
      }
    }

    const byService = [...serviceTotals.entries()]
      .map(([service, amount]) => ({ service, amount: roundCurrency(amount) }))
      .sort((a, b) => b.amount - a.amount);

    return {
      accountId: ref.accountId,
      currency,
      total: roundCurrency(total),
      byService,
      byDay,
      fetchedAt: new Date().toISOString(),
    };
  }
}

