import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { OrganizationsClient } from '@aws-sdk/client-organizations';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import {
  CloudProviderError,
  DEFAULT_AWS_REGION,
  MSP_MASTER_ROLE_NAME,
  type CrossAccountRef,
} from '@whitehouse/shared';

import type { AwsCredentials } from './sts-assume-role-provider';

/**
 * Every AWS call in this repository is created here, so cross-account access is
 * structurally enforced rather than left to reviewer discipline:
 *   - `createManagementClient` runs as the MSP management account.
 *   - `AssumeRoleClientFactory` hands out clients bound to one tenant's
 *     temporary, cached session.
 *
 * Nothing in this file can produce a long-lived credential.
 */

export function createManagementStsClient(region = DEFAULT_AWS_REGION): STSClient {
  return new STSClient({ region });
}

export function createManagementOrganizationsClient(
  region = DEFAULT_AWS_REGION,
): OrganizationsClient {
  return new OrganizationsClient({ region });
}

/** Cost Explorer has a single global endpoint; us-east-1 is the canonical one. */
export function createManagementCostExplorerClient(region = DEFAULT_AWS_REGION): CostExplorerClient {
  return new CostExplorerClient({ region });
}

export interface AssumeRoleSessionProvider {
  assumeRole(ref: CrossAccountRef, options?: { forceRefresh?: boolean }): Promise<{
    credentials: AwsCredentials;
    accountId: string;
    assumedRoleArn: string;
    callerArn: string;
    expiration: Date | null;
  }>;
}

/**
 * Builds tenant-scoped clients from an assumed role session.
 *
 * Cost Explorer is created in `us-east-1` even when the tenant lives elsewhere:
 * the API only exists in a single region, and calling it from another region
 * fails with a misleading `AccessDenied`.
 */
export class AssumeRoleClientFactory {
  constructor(private readonly sessions: AssumeRoleSessionProvider) {}

  async getCostExplorerClient(ref: CrossAccountRef): Promise<CostExplorerClient> {
    const session = await this.sessions.assumeRole(ref);
    return new CostExplorerClient({ region: DEFAULT_AWS_REGION, credentials: session.credentials });
  }

  async getOrganizationsClient(ref: CrossAccountRef): Promise<OrganizationsClient> {
    const session = await this.sessions.assumeRole(ref);
    return new OrganizationsClient({ region: ref.region, credentials: session.credentials });
  }

  async getStsClient(ref: CrossAccountRef): Promise<STSClient> {
    const session = await this.sessions.assumeRole(ref);
    return new STSClient({ region: ref.region, credentials: session.credentials });
  }
}

/** Confirms the MSP's own identity before any cross-account work starts. */
export async function getManagementAccountIdentity(client: STSClient): Promise<{
  accountId: string;
  arn: string;
}> {
  try {
    const identity = await client.send(new GetCallerIdentityCommand({}));
    if (!identity.Account) {
      throw new CloudProviderError('MSP_IDENTITY_MISSING', 'STS returned no account ID', false);
    }
    return { accountId: identity.Account, arn: identity.Arn ?? '' };
  } catch (error) {
    if (error instanceof CloudProviderError) throw error;
    throw new CloudProviderError(
      'MSP_IDENTITY_FAILED',
      `Could not resolve the MSP management account identity: ${
        (error as Error).message
      }. Check AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.`,
      false,
    );
  }
}

export { MSP_MASTER_ROLE_NAME };
