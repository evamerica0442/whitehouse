import {
  CROSS_ACCOUNT_ROLES,
  DELIVERY_METHODS,
  type AssignGovernanceInput,
  type CloudProvider,
  type DeliveryChoiceInput,
  type DeliveryMethod,
  type DeliveryStatus,
  type GenerateTemplateInput,
  type OnboardingState,
  type OnboardingTemplate,
  type TenantStatus,
  type TestConnectionInput,
  type TestConnectionResult,
} from '@whitehouse/shared';
import { buildOnboardingTemplate } from '@whitehouse/aws-sdk-wrapper';
import type { PrismaClient, Tenant } from '@whitehouse/db';

import type { AppConfig } from '../config/env';
import type { EmailSender } from '../email/email-sender';
import { buildOnboardingEmail } from '../email/onboarding-email';
import { AppError } from '../lib/errors';
import { writeAuditLog } from './audit-service';
import {
  assertTransition,
  canTransition,
  canVerifyConnection,
  deriveCompletedSteps,
  deriveCurrentStep,
  statusAfterTemplateDelivered,
} from './onboarding-state';
import { getTenantOrThrow, getTenantSummaryById } from './tenant-service';

export interface AppLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export interface OnboardingDependencies {
  prisma: PrismaClient;
  config: AppConfig;
  cloud: CloudProvider;
  email: EmailSender;
  logger: AppLogger;
}

export interface ActorContext {
  userId: string | null;
  email: string | null;
  ipAddress?: string | null;
  requestId?: string | null;
}

/**
 * The MSP management account ID is what the customer's trust policy points at.
 * Generating a template without it would silently bake in a placeholder, so we
 * refuse instead.
 */
export function requireMspAccountId(config: AppConfig): string {
  if (!config.AWS_MANAGEMENT_ACCOUNT_ID) {
    throw AppError.validation(
      'AWS_MANAGEMENT_ACCOUNT_ID is not configured — set it to the MSP management account before generating onboarding templates.',
    );
  }
  return config.AWS_MANAGEMENT_ACCOUNT_ID;
}

/**
 * The template is *derived* from tenant state rather than stored: given the same
 * tenant record it always produces the same document, so there is no chance of a
 * stale template floating around after the tenant is edited.
 */
export function buildTenantTemplate(config: AppConfig, tenant: Tenant): OnboardingTemplate {
  const bundle = buildOnboardingTemplate({
    mspAccountId: requireMspAccountId(config),
    customerName: tenant.customerName,
    externalId: tenant.externalId,
    region: tenant.region,
    ...(tenant.awsAccountId ? { customerAccountId: tenant.awsAccountId } : {}),
  });

  return {
    tenantId: tenant.id,
    stackName: bundle.stackName,
    roleArn: bundle.roleArn,
    roleNames: bundle.roleNames,
    externalId: bundle.externalId,
    templateBody: bundle.templateBody,
    instructions: bundle.instructions,
    launchUrl: `https://console.aws.amazon.com/cloudformation/home?region=${tenant.region}#/stacks/create`,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Records that the admin generated the template. The workflow state ("has a
 * template been produced?") is read back from these audit rows, which keeps the
 * workflow ledger append-only and queryable.
 */
export async function recordTemplateGenerated(
  deps: OnboardingDependencies,
  tenantId: string,
  actor: ActorContext,
  input: GenerateTemplateInput = {},
): Promise<OnboardingTemplate> {
  const original = await getTenantOrThrow(deps.prisma, tenantId);

  const tenant =
    input.region && input.region !== original.region
      ? await deps.prisma.tenant.update({
          where: { id: tenantId },
          data: { region: input.region },
        })
      : original;

  const template = buildTenantTemplate(deps.config, tenant);

  await writeAuditLog(
    deps.prisma,
    {
      action: 'ONBOARDING_TEMPLATE_GENERATED',
      actorUserId: actor.userId,
      actorEmail: actor.email,
      tenantId,
      targetType: 'cloudformation_template',
      targetId: template.stackName,
      detail: {
        externalId: template.externalId,
        roleNames: template.roleNames,
        region: tenant.region,
      },
      ipAddress: actor.ipAddress ?? null,
      requestId: actor.requestId ?? null,
    },
    deps.logger,
  );

  return template;
}

/**
 * Reads the wizard's state.
 *
 * Two workflow facts — "has a template been generated" and "when did we last
 * prove access" — are read back from the append-only audit trail rather than
 * duplicated into mutable tenant columns. The tenant row keeps only the durable
 * outcomes (`lastVerifiedAt`, `status`).
 */
export async function getOnboardingState(
  deps: OnboardingDependencies,
  tenantId: string,
): Promise<OnboardingState> {
  const tenant = await getTenantOrThrow(deps.prisma, tenantId);

  const [
    generatedTemplateAudit,
    latestDelivery,
    lastTestAudit,
    guardrailCount,
    scpAssignmentCount,
    templateAccessCount,
    summary,
  ] = await Promise.all([
    deps.prisma.auditLog.findFirst({
      where: { tenantId, action: 'ONBOARDING_TEMPLATE_GENERATED' },
      orderBy: { createdAt: 'desc' },
    }),
    deps.prisma.onboardingDelivery.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    }),
    deps.prisma.auditLog.findFirst({
      where: { tenantId, action: 'ONBOARDING_CONNECTION_VERIFIED' },
      orderBy: { createdAt: 'desc' },
    }),
    deps.prisma.tenantGuardrail.count({ where: { tenantId } }),
    deps.prisma.tenantScpAssignment.count({ where: { tenantId } }),
    deps.prisma.tenantTemplateAccess.count({ where: { tenantId } }),
    getTenantSummaryById(deps.prisma, tenantId),
  ]);

  const stepsInput = {
    status: tenant.status,
    hasTemplate: Boolean(generatedTemplateAudit),
    hasDelivery: latestDelivery?.status === 'SENT',
    hasVerifiedConnection: Boolean(tenant.lastVerifiedAt),
    hasGovernance: guardrailCount + scpAssignmentCount + templateAccessCount > 0,
    awsAccountId: tenant.awsAccountId,
    roleArn: tenant.roleArn,
  };

  let template: OnboardingTemplate | null = null;
  if (stepsInput.hasTemplate) {
    try {
      template = buildTenantTemplate(deps.config, tenant);
    } catch {
      // Configuration regressed (e.g. AWS_MANAGEMENT_ACCOUNT_ID removed) — the
      // wizard still loads and tells the admin what is missing on the next step.
      template = null;
    }
  }

  return {
    tenant: summary,
    currentStep: deriveCurrentStep(stepsInput),
    completedSteps: deriveCompletedSteps(stepsInput),
    canVerify: canVerifyConnection(stepsInput),
    template,
    lastConnectionTest: (lastTestAudit?.detail as TestConnectionResult | null) ?? null,
    availableDeliveryMethods: [...DELIVERY_METHODS],
  };
}

export interface DeliverTemplateResult {
  deliveryId: string;
  method: DeliveryMethod;
  status: DeliveryStatus;
  recipient: string | null;
  providerMessageId: string | null;
  error: string | null;
  tenantStatus: TenantStatus;
  /** Regenerated bundle, so the manual path can render it in the browser. */
  template: OnboardingTemplate;
}

async function applyStatus(
  prisma: PrismaClient,
  tenant: Tenant,
  next: TenantStatus,
): Promise<TenantStatus> {
  if (next === tenant.status) return tenant.status;
  assertTransition(tenant.status, next);
  const updated = await prisma.tenant.update({
    where: { id: tenant.id },
    data: { status: next },
    select: { status: true },
  });
  return updated.status;
}

/**
 * Step 3 of the wizard: hand the template to the customer.
 *
 * Manual and automated delivery are always both available — this is a
 * per-onboarding decision, not a global setting. Every attempt is recorded as an
 * `OnboardingDelivery` row so "sent" or "failed" is auditable per attempt, and a
 * failed email never blocks the manual path.
 */
export async function deliverTemplate(
  deps: OnboardingDependencies,
  tenantId: string,
  input: DeliveryChoiceInput,
  actor: ActorContext,
): Promise<DeliverTemplateResult> {
  const tenant = await getTenantOrThrow(deps.prisma, tenantId);
  const template = buildTenantTemplate(deps.config, tenant);
  const recipient = input.recipientEmail ?? tenant.contactEmail;

  if (input.method === 'MANUAL') {
    const delivery = await deps.prisma.onboardingDelivery.create({
      data: {
        tenantId,
        method: 'MANUAL',
        status: 'SENT',
        recipient,
        subject: `Manual handover of ${template.stackName}`,
        attemptedAt: new Date(),
        sentByUserId: actor.userId,
      },
    });

    const tenantStatus = await applyStatus(
      deps.prisma,
      tenant,
      statusAfterTemplateDelivered(tenant.status),
    );

    await writeAuditLog(
      deps.prisma,
      {
        action: 'ONBOARDING_TEMPLATE_DELIVERED',
        actorUserId: actor.userId,
        actorEmail: actor.email,
        tenantId,
        targetType: 'onboarding_delivery',
        targetId: delivery.id,
        detail: { method: 'MANUAL', externalId: template.externalId },
        ipAddress: actor.ipAddress ?? null,
        requestId: actor.requestId ?? null,
      },
      deps.logger,
    );

    return {
      deliveryId: delivery.id,
      method: 'MANUAL',
      status: 'SENT',
      recipient,
      providerMessageId: null,
      error: null,
      tenantStatus,
      template,
    };
  }

  const subject = `Action required: grant Whitehouse Cloudguard access to ${tenant.customerName}`;

  // Recorded as PENDING first so a crash mid-send still leaves a trace.
  const pending = await deps.prisma.onboardingDelivery.create({
    data: {
      tenantId,
      method: 'AUTOMATED',
      status: 'PENDING',
      recipient,
      subject,
      attemptedAt: new Date(),
      sentByUserId: actor.userId,
    },
  });

  const email = buildOnboardingEmail({
    tenant,
    template,
    mspAccountId: requireMspAccountId(deps.config),
    senderName: deps.config.EMAIL_FROM,
  });

  const sendResult = await deps.email.send({ ...email, to: recipient });

  const delivery = await deps.prisma.onboardingDelivery.update({
    where: { id: pending.id },
    data: {
      status: sendResult.ok ? 'SENT' : 'FAILED',
      providerMessageId: sendResult.providerMessageId,
      error: sendResult.error,
      attemptedAt: new Date(),
    },
  });

  const tenantStatus = sendResult.ok
    ? await applyStatus(deps.prisma, tenant, statusAfterTemplateDelivered(tenant.status))
    : tenant.status;

  await writeAuditLog(
    deps.prisma,
    {
      action: 'ONBOARDING_TEMPLATE_DELIVERED',
      outcome: sendResult.ok ? 'SUCCESS' : 'FAILURE',
      actorUserId: actor.userId,
      actorEmail: actor.email,
      tenantId,
      targetType: 'onboarding_delivery',
      targetId: delivery.id,
      detail: {
        method: 'AUTOMATED',
        recipient,
        providerMessageId: sendResult.providerMessageId,
        error: sendResult.error,
      },
      ipAddress: actor.ipAddress ?? null,
      requestId: actor.requestId ?? null,
    },
    deps.logger,
  );

  return {
    deliveryId: delivery.id,
    method: 'AUTOMATED',
    status: delivery.status,
    recipient,
    providerMessageId: sendResult.providerMessageId,
    error: sendResult.error,
    tenantStatus,
    template,
  };
}

/** The read-only role ARN in the customer account, derived from their account ID. */
export function deriveRoleArn(
  awsAccountId: string,
  roleName: string = CROSS_ACCOUNT_ROLES.readOnly,
): string {
  return `arn:aws:iam::${awsAccountId}:role/${roleName}`;
}

/**
 * Step 4: prove we can actually assume the role, before the tenant goes live.
 *
 * The provider is called with `forceRefresh`, so a success always represents a
 * live STS round trip rather than a cached session. The result is written to the
 * audit trail, which is what the wizard reads back to show the last test.
 */
export async function verifyConnection(
  deps: OnboardingDependencies,
  tenantId: string,
  input: TestConnectionInput,
  actor: ActorContext,
): Promise<TestConnectionResult> {
  const tenant = await getTenantOrThrow(deps.prisma, tenantId);
  const roleArn = input.roleArn ?? tenant.roleArn ?? deriveRoleArn(input.awsAccountId);

  const ref = {
    tenantId,
    accountId: input.awsAccountId,
    roleArn,
    externalId: tenant.externalId,
    region: tenant.region,
  };

  const check = await deps.cloud.verifyCrossAccountAccess(ref);

  // Probes are informational; a probe failure must not invalidate a working role.
  const probes = check.ok
    ? await deps.cloud.runPermissionProbes(ref).catch((error: unknown) => {
        deps.logger.warn({ err: error, tenantId }, 'permission probes failed');
        return [];
      })
    : [];

  const result: TestConnectionResult = {
    ok: check.ok,
    accountId: check.accountId,
    assumedRoleArn: check.assumedRoleArn,
    callerIdentity: check.callerIdentity,
    expiresAt: check.expiresAt,
    latencyMs: check.latencyMs,
    errorCode: check.errorCode,
    errorMessage: check.errorMessage,
    probes,
  };

  const shouldAdvance = check.ok && canTransition(tenant.status, 'AWAITING_VERIFICATION');

  await deps.prisma.tenant.update({
    where: { id: tenantId },
    data: {
      awsAccountId: input.awsAccountId,
      roleArn,
      ...(check.ok ? { lastVerifiedAt: new Date() } : {}),
      ...(shouldAdvance ? { status: 'AWAITING_VERIFICATION' } : {}),
    },
  });

  await writeAuditLog(
    deps.prisma,
    {
      action: 'ONBOARDING_CONNECTION_VERIFIED',
      outcome: check.ok ? 'SUCCESS' : 'FAILURE',
      actorUserId: actor.userId,
      actorEmail: actor.email,
      tenantId,
      targetType: 'cross_account_role',
      targetId: roleArn,
      detail: { ...result },
      ipAddress: actor.ipAddress ?? null,
      requestId: actor.requestId ?? null,
    },
    deps.logger,
  );

  return result;
}

export interface GovernanceAssignmentResult {
  tenantId: string;
  guardrailKeys: string[];
  scpPolicyIds: string[];
  templateKeys: string[];
  missingGuardrailKeys: string[];
  missingTemplateKeys: string[];
  status: TenantStatus;
  tenant: Awaited<ReturnType<typeof getTenantSummaryById>>;
}

/**
 * Step 5: apply the initial governance baseline and catalog entitlements.
 *
 * Activation is refused until the cross-account role has been verified — the whole
 * point of the pipeline is that a tenant is never marked Active on the strength of
 * an untested role. Unknown keys are reported back rather than silently dropped.
 */
export async function assignGovernance(
  deps: OnboardingDependencies,
  tenantId: string,
  input: AssignGovernanceInput,
  actor: ActorContext,
): Promise<GovernanceAssignmentResult> {
  const tenant = await getTenantOrThrow(deps.prisma, tenantId);

  if (input.activateTenant && !tenant.lastVerifiedAt) {
    throw AppError.tenantNotReady(
      'Run "Test Connection" successfully before activating this tenant — access has not been verified.',
    );
  }

  const guardrails = input.guardrailKeys.length
    ? await deps.prisma.guardrail.findMany({
        where: { key: { in: input.guardrailKeys }, isActive: true },
        select: { id: true, key: true },
      })
    : [];

  const missingGuardrailKeys = input.guardrailKeys.filter(
    (key) => !guardrails.some((guardrail) => guardrail.key === key),
  );

  if (guardrails.length > 0) {
    await deps.prisma.tenantGuardrail.createMany({
      data: guardrails.map((guardrail) => ({
        tenantId,
        guardrailId: guardrail.id,
        enabled: true,
        state: 'UNKNOWN' as const,
        assignedByUserId: actor.userId,
      })),
      skipDuplicates: true,
    });
  }

  if (input.scpPolicyIds.length > 0) {
    await deps.prisma.tenantScpAssignment.createMany({
      data: input.scpPolicyIds.map((scpPolicyId) => ({
        tenantId,
        scpPolicyId,
        attachedByUserId: actor.userId,
      })),
      skipDuplicates: true,
    });
  }

  // Only approved templates are grantable: an unapproved template must never become
  // deployable simply because someone typed its key into a request.
  const templates = input.templateKeys.length
    ? await deps.prisma.catalogTemplate.findMany({
        where: { key: { in: input.templateKeys }, status: 'APPROVED' },
        select: { id: true, key: true },
      })
    : [];

  const missingTemplateKeys = input.templateKeys.filter(
    (key) => !templates.some((template) => template.key === key),
  );

  if (templates.length > 0) {
    await deps.prisma.tenantTemplateAccess.createMany({
      data: templates.map((template) => ({
        tenantId,
        templateId: template.id,
        grantedByUserId: actor.userId,
      })),
      skipDuplicates: true,
    });
  }

  let status = tenant.status;
  if (input.activateTenant && canTransition(tenant.status, 'ACTIVE')) {
    const updated = await deps.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: 'ACTIVE', onboardedAt: tenant.onboardedAt ?? new Date() },
      select: { status: true },
    });
    status = updated.status;
  }

  await writeAuditLog(
    deps.prisma,
    {
      action: 'GUARDRAILS_ASSIGNED',
      actorUserId: actor.userId,
      actorEmail: actor.email,
      tenantId,
      targetType: 'governance_baseline',
      targetId: tenantId,
      detail: {
        guardrailKeys: guardrails.map((guardrail) => guardrail.key),
        scpPolicyIds: input.scpPolicyIds,
        templateKeys: templates.map((template) => template.key),
        missingGuardrailKeys,
        missingTemplateKeys,
      },
      ipAddress: actor.ipAddress ?? null,
      requestId: actor.requestId ?? null,
    },
    deps.logger,
  );

  if (status === 'ACTIVE') {
    await writeAuditLog(
      deps.prisma,
      {
        action: 'ONBOARDING_COMPLETED',
        actorUserId: actor.userId,
        actorEmail: actor.email,
        tenantId,
        targetType: 'tenant',
        targetId: tenantId,
        detail: { roleArn: tenant.roleArn, awsAccountId: tenant.awsAccountId },
        ipAddress: actor.ipAddress ?? null,
        requestId: actor.requestId ?? null,
      },
      deps.logger,
    );
  }

  return {
    tenantId,
    guardrailKeys: guardrails.map((guardrail) => guardrail.key),
    scpPolicyIds: input.scpPolicyIds,
    templateKeys: templates.map((template) => template.key),
    missingGuardrailKeys,
    missingTemplateKeys,
    status,
    tenant: await getTenantSummaryById(deps.prisma, tenantId),
  };
}




