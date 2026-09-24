import { describe, expect, it } from 'vitest';

import { AppError } from '../lib/errors';
import {
  assertTransition,
  canTransition,
  canVerifyConnection,
  deriveCompletedSteps,
  deriveCurrentStep,
  ONBOARDING_STEP_ORDER,
  statusAfterTemplateDelivered,
  type OnboardingStateInput,
} from './onboarding-state';

const baseState: OnboardingStateInput = {
  status: 'NOT_STARTED',
  hasTemplate: false,
  hasDelivery: false,
  hasVerifiedConnection: false,
  hasGovernance: false,
  awsAccountId: null,
  roleArn: null,
};

describe('tenant status transitions', () => {
  it('walks the happy path NOT_STARTED -> TEMPLATE_SENT -> AWAITING_VERIFICATION -> ACTIVE', () => {
    expect(canTransition('NOT_STARTED', 'TEMPLATE_SENT')).toBe(true);
    expect(canTransition('TEMPLATE_SENT', 'AWAITING_VERIFICATION')).toBe(true);
    expect(canTransition('AWAITING_VERIFICATION', 'ACTIVE')).toBe(true);
  });

  it('allows re-delivery without regressing a tenant', () => {
    expect(statusAfterTemplateDelivered('TEMPLATE_SENT')).toBe('TEMPLATE_SENT');
    expect(statusAfterTemplateDelivered('AWAITING_VERIFICATION')).toBe('TEMPLATE_SENT');
    expect(statusAfterTemplateDelivered('ACTIVE')).toBe('ACTIVE');
  });

  it('refuses to skip verification', () => {
    expect(canTransition('NOT_STARTED', 'ACTIVE')).toBe(false);
    expect(canTransition('TEMPLATE_SENT', 'ACTIVE')).toBe(false);
    expect(() => assertTransition('NOT_STARTED', 'ACTIVE')).toThrow(AppError);
  });

  it('never transitions backwards out of ACTIVE', () => {
    expect(canTransition('ACTIVE', 'TEMPLATE_SENT')).toBe(false);
    expect(canTransition('ACTIVE', 'AWAITING_VERIFICATION')).toBe(false);
    expect(canTransition('ACTIVE', 'ACTIVE')).toBe(true);
  });
});

describe('deriveCurrentStep', () => {
  it('starts at DETAILS before a template exists', () => {
    expect(deriveCurrentStep(baseState)).toBe('DETAILS');
  });

  it('advances through each gate in order', () => {
    expect(deriveCurrentStep({ ...baseState, hasTemplate: true })).toBe('DELIVERY');
    expect(deriveCurrentStep({ ...baseState, hasTemplate: true, hasDelivery: true })).toBe(
      'VERIFICATION',
    );
    expect(
      deriveCurrentStep({
        ...baseState,
        hasTemplate: true,
        hasDelivery: true,
        hasVerifiedConnection: true,
      }),
    ).toBe('GOVERNANCE');
    expect(deriveCurrentStep({ ...baseState, status: 'ACTIVE' })).toBe('COMPLETE');
  });

  it('does not require governance to be complete before verification', () => {
    // Governance is a step, not a precondition for testing the connection.
    expect(
      deriveCurrentStep({
        ...baseState,
        hasTemplate: true,
        hasDelivery: true,
        hasGovernance: false,
      }),
    ).toBe('VERIFICATION');
  });
});

describe('deriveCompletedSteps', () => {
  it('reports every completed gate cumulatively', () => {
    const completed = deriveCompletedSteps({
      ...baseState,
      status: 'ACTIVE',
      hasTemplate: true,
      hasDelivery: true,
      hasVerifiedConnection: true,
      hasGovernance: true,
    });

    expect(completed).toEqual([...ONBOARDING_STEP_ORDER]);
  });

  it('always counts DETAILS as done once a tenant exists', () => {
    expect(deriveCompletedSteps(baseState)).toEqual(['DETAILS']);
  });
});

describe('canVerifyConnection', () => {
  it('needs both an account ID and a role ARN', () => {
    expect(canVerifyConnection({ awsAccountId: null, roleArn: null })).toBe(false);
    expect(canVerifyConnection({ awsAccountId: '444455556666', roleArn: null })).toBe(false);
    expect(
      canVerifyConnection({
        awsAccountId: '444455556666',
        roleArn: 'arn:aws:iam::444455556666:role/WhitehouseCloudGuard-ReadOnly',
      }),
    ).toBe(true);
  });
});
