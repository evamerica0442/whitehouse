/**
 * Domain enums shared by the API, the worker, and the web app.
 *
 * These are declared as `const` objects rather than TS `enum`s on purpose:
 * they are consumed both by TypeScript and by zod schemas / Prisma string
 * columns, and plain objects survive `isolatedModules` + bundler boundaries
 * without emitting runtime helpers.
 */

export const ADMIN_ROLES = ['SUPER_ADMIN', 'ENGINEER', 'READ_ONLY'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Ordered: the onboarding wizard advances a tenant through these states. */
export const TENANT_STATUSES = [
  'NOT_STARTED',
  'TEMPLATE_SENT',
  'AWAITING_VERIFICATION',
  'ACTIVE',
] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const ENVIRONMENT_TYPES = ['PRODUCTION', 'STAGING', 'DEVELOPMENT', 'SANDBOX'] as const;
export type EnvironmentType = (typeof ENVIRONMENT_TYPES)[number];

/** How the cross-account CloudFormation template reaches the customer. */
export const DELIVERY_METHODS = ['MANUAL', 'AUTOMATED'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const DELIVERY_STATUSES = ['NOT_SENT', 'PENDING', 'SENT', 'FAILED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const GUARDRAIL_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type GuardrailSeverity = (typeof GUARDRAIL_SEVERITIES)[number];

export const GUARDRAIL_CATEGORIES = [
  'SECURITY',
  'LOGGING',
  'ENCRYPTION',
  'NETWORK',
  'COST',
  'RESILIENCE',
] as const;
export type GuardrailCategory = (typeof GUARDRAIL_CATEGORIES)[number];

/** Result of evaluating a guardrail against a tenant account. */
export const COMPLIANCE_STATES = ['COMPLIANT', 'NON_COMPLIANT', 'UNKNOWN', 'NOT_APPLICABLE'] as const;
export type ComplianceState = (typeof COMPLIANCE_STATES)[number];

export const HEALTH_INDICATORS = ['GREEN', 'YELLOW', 'RED'] as const;
export type HealthIndicator = (typeof HEALTH_INDICATORS)[number];

export const TEMPLATE_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'DEPRECATED'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const TEMPLATE_KINDS = ['CLOUDFORMATION', 'CDK'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const DEPLOYMENT_STATUSES = [
  'QUEUED',
  'IN_PROGRESS',
  'SUCCEEDED',
  'FAILED',
  'ROLLED_BACK',
] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

/** Canonical job names for the provider-agnostic queue (`JobQueue`). */
export const JOB_NAMES = [
  'tenant.verify-connection',
  'tenant.apply-guardrails',
  'tenant.send-onboarding-email',
  'cost.refresh-snapshot',
  'guardrail.run-checks',
  'catalog.deploy-template',
] as const;
export type JobName = (typeof JOB_NAMES)[number];

export const AUDIT_ACTIONS = [
  'USER_LOGIN',
  'USER_LOGIN_FAILED',
  'USER_LOGOUT',
  'USER_INVITED',
  'TENANT_CREATED',
  'TENANT_UPDATED',
  'ONBOARDING_TEMPLATE_GENERATED',
  'ONBOARDING_TEMPLATE_DELIVERED',
  'ONBOARDING_CONNECTION_VERIFIED',
  'ONBOARDING_COMPLETED',
  'GUARDRAILS_ASSIGNED',
  'COST_SNAPSHOT_REFRESHED',
  'TEMPLATE_PUBLISHED',
  'TEMPLATE_DEPLOYED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_OUTCOMES = ['SUCCESS', 'FAILURE', 'DENIED'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
