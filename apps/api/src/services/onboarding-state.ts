import {
  type OnboardingStep,
  type TenantStatus,
  TENANT_STATUSES,
} from '@whitehouse/shared';

import { AppError } from '../lib/errors';

/**
 * The onboarding state machine.
 *
 * Kept as pure functions so the wizard's behaviour is unit-testable without a
 * database, and so both the API and the web app agree on what "current step"
 * means for a given tenant record.
 */
export const ONBOARDING_STEP_ORDER: readonly OnboardingStep[] = [
  'DETAILS',
  'TEMPLATE',
  'DELIVERY',
  'VERIFICATION',
  'GOVERNANCE',
  'COMPLETE',
] as const;

/**
 * Allowed tenant status transitions.
 *
 *   NOT_STARTED ──▶ TEMPLATE_SENT ──▶ AWAITING_VERIFICATION ──▶ ACTIVE
 *                        ▲                      │
 *                        └──────────────────────┘  (re-send / role re-created)
 *
 * Activation is only reachable from AWAITING_VERIFICATION — i.e. after a successful
 * STS AssumeRole. There are no backwards transitions out of ACTIVE, because a
 * partially onboarded tenant must stay visible in the pipeline until it genuinely
 * completes.
 */
const ALLOWED_TRANSITIONS: Record<TenantStatus, readonly TenantStatus[]> = {
  NOT_STARTED: ['TEMPLATE_SENT'],
  TEMPLATE_SENT: ['TEMPLATE_SENT', 'AWAITING_VERIFICATION'],
  AWAITING_VERIFICATION: ['TEMPLATE_SENT', 'AWAITING_VERIFICATION', 'ACTIVE'],
  ACTIVE: ['ACTIVE'],
};

export function canTransition(from: TenantStatus, to: TenantStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TenantStatus, to: TenantStatus): void {
  if (!canTransition(from, to)) {
    throw AppError.conflict(
      `Cannot move tenant from ${from} to ${to}. Allowed: ${ALLOWED_TRANSITIONS[from].join(', ')}`,
    );
  }
}

export interface OnboardingStateInput {
  status: TenantStatus;
  /** A CloudFormation bundle has been generated for this tenant. */
  hasTemplate: boolean;
  /** The template has been handed over (manual download or emailed) at least once. */
  hasDelivery: boolean;
  /** A successful STS AssumeRole verification is on record. */
  hasVerifiedConnection: boolean;
  /** Guardrails/templates/SCPs have been assigned. */
  hasGovernance: boolean;
  awsAccountId: string | null;
  roleArn: string | null;
}

export function deriveCurrentStep(input: OnboardingStateInput): OnboardingStep {
  if (input.status === 'ACTIVE') return 'COMPLETE';
  if (!input.hasTemplate) return 'DETAILS';
  if (!input.hasDelivery) return 'DELIVERY';
  if (!input.hasVerifiedConnection) return 'VERIFICATION';
  return 'GOVERNANCE';
}

export function deriveCompletedSteps(input: OnboardingStateInput): OnboardingStep[] {
  const completed: OnboardingStep[] = ['DETAILS'];

  if (input.hasTemplate) completed.push('TEMPLATE');
  if (input.hasDelivery) completed.push('DELIVERY');
  if (input.hasVerifiedConnection) completed.push('VERIFICATION');
  if (input.hasGovernance) completed.push('GOVERNANCE');
  if (input.status === 'ACTIVE') completed.push('COMPLETE');

  return completed;
}

/**
 * Test Connection requires knowing *which* account and role to assume. The
 * wizard blocks the step until the customer's account ID and role ARN are
 * captured, which avoids a confusing AccessDenied from a placeholder ARN.
 */
export function canVerifyConnection(
  input: Pick<OnboardingStateInput, 'awsAccountId' | 'roleArn'>,
): boolean {
  return Boolean(input.awsAccountId && input.roleArn);
}

export function statusAfterTemplateDelivered(current: TenantStatus): TenantStatus {
  return current === 'ACTIVE' ? 'ACTIVE' : 'TEMPLATE_SENT';
}

export function isTenantStatus(value: string): value is TenantStatus {
  return (TENANT_STATUSES as readonly string[]).includes(value);
}
