/**
 * CloudProvider — the seam that keeps this MVP from being welded to AWS.
 *
 * Everything the platform does against a customer account goes through this
 * interface. `AwsCloudProvider` implements it with STS AssumeRole + SDK v3
 * clients; `MockCloudProvider` implements it with deterministic fixtures so the
 * console runs on the free tier (and in CI) without customer credentials.
 */

export const CLOUD_PROVIDER_IDS = ['aws', 'mock'] as const;
export type CloudProviderId = (typeof CLOUD_PROVIDER_IDS)[number];

/** Everything needed to reach a customer account. No long-lived secrets, ever. */
export interface CrossAccountRef {
  tenantId: string;
  /** 12-digit AWS account ID. */
  accountId: string;
  /** Role assumed inside the customer account. */
  roleArn: string;
  /** Per-tenant confused-deputy guard, embedded in the CFN template. */
  externalId: string;
  /** Region used for regional service calls (Cost Explorer/STS are global). */
  region: string;
}

export interface AssumeRoleCheck {
  ok: boolean;
  accountId: string | null;
  assumedRoleArn: string | null;
  callerIdentity: string | null;
  expiresAt: string | null;
  latencyMs: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface PermissionProbe {
  name: string;
  ok: boolean;
  detail: string | null;
}

export interface AccountFacts {
  accountId: string;
  accountName: string | null;
  accountEmail: string | null;
  status: string | null;
  joinedMethod: string | null;
  organizationalUnitPath: string | null;
}

export interface CostQuery {
  /** Inclusive start date, `YYYY-MM-DD`. */
  startDate: string;
  /** Exclusive end date, `YYYY-MM-DD` (Cost Explorer semantics). */
  endDate: string;
  granularity: 'DAILY' | 'MONTHLY';
}

export interface ServiceCost {
  service: string;
  amount: number;
}

export interface DailyCost {
  date: string;
  amount: number;
}

export interface CostBreakdown {
  accountId: string;
  currency: string;
  total: number;
  byService: ServiceCost[];
  byDay: DailyCost[];
  fetchedAt: string;
}

export interface CloudProvider {
  readonly id: CloudProviderId;

  /** STS AssumeRole + GetCallerIdentity. Powers the wizard's "Test Connection". */
  verifyCrossAccountAccess(ref: CrossAccountRef): Promise<AssumeRoleCheck>;

  /** Optional read-only probes run with the temporary session (S3, IAM, CloudTrail...). */
  runPermissionProbes(ref: CrossAccountRef): Promise<PermissionProbe[]>;

  /** Account metadata for the tenant detail view. */
  getAccountFacts(ref: CrossAccountRef): Promise<AccountFacts>;

  /** Cost Explorer GetCostAndUsage, always called from a background job. */
  getCostAndUsage(ref: CrossAccountRef, query: CostQuery): Promise<CostBreakdown>;

  /** Future: Control Tower guardrail state per account. Declared, not implemented in M1. */
  getGuardrailState?(ref: CrossAccountRef, guardrailKeys: string[]): Promise<GuardrailState[]>;

  /** Future: Service Catalog provisioning of a published template. */
  deployTemplate?(ref: CrossAccountRef, input: TemplateDeploymentInput): Promise<TemplateDeploymentResult>;
}

export interface GuardrailState {
  guardrailKey: string;
  compliant: boolean;
  detail: string | null;
  checkedAt: string;
}

export interface TemplateDeploymentInput {
  templateKey: string;
  version: string;
  stackName: string;
  parameters: Record<string, string>;
}

export interface TemplateDeploymentResult {
  deploymentId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'IN_PROGRESS';
  message: string | null;
}

/** Thrown by providers for expected, user-surfaceable cloud failures. */
export class CloudProviderError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'CloudProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}
