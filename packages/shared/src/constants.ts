/**
 * Constants that both the web app and the API need to agree on.
 * Anything here must stay free of Node- or browser-specific APIs.
 */

/** AWS region used for Organizations, STS, and Cost Explorer calls. */
export const DEFAULT_AWS_REGION = 'us-east-1';

/** Regions offered in the onboarding wizard. Keep the CFN template region-agnostic. */
export const SUPPORTED_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-south-1',
] as const;
export type SupportedRegion = (typeof SUPPORTED_REGIONS)[number];

/** Cross-account role names created by the generated CloudFormation template. */
export const CROSS_ACCOUNT_ROLES = {
  /** Read-only discovery: Cost Explorer, resource listing, guardrail checks. */
  readOnly: 'WhitehouseCloudGuard-ReadOnly',
  /** Write operations: Service Catalog provisioning, SCP application. */
  operator: 'WhitehouseCloudGuard-Operator',
} as const;

/** Name of the IAM role the MSP management account assumes via its own identity. */
export const MSP_MASTER_ROLE_NAME = 'WhitehouseCloudGuard-MSP-Operator';

export const DEFAULT_SESSION_TTL_HOURS = 12;
export const DEFAULT_MAGIC_LINK_TTL_MINUTES = 20;

/** Cost Explorer API is billed per request — the dashboard must never call it inline. */
export const COST_SNAPSHOT_MAX_AGE_HOURS = 24;

export const HTTP_STATUS = {
  ok: 200,
  created: 201,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  unprocessable: 422,
  tooManyRequests: 429,
  serverError: 500,
} as const;
