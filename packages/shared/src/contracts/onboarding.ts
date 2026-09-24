import { z } from 'zod';

import { DELIVERY_METHODS } from '../enums';
import { uuidField } from './common';
import { awsAccountIdSchema, deliveryMethodSchema, tenantSummarySchema } from './tenant';

/** Wizard steps, in order. The API derives the current step from tenant state. */
export const ONBOARDING_STEPS = [
  'DETAILS',
  'TEMPLATE',
  'DELIVERY',
  'VERIFICATION',
  'GOVERNANCE',
  'COMPLETE',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const deliveryChoiceSchema = z.object({
  method: deliveryMethodSchema,
  /** Required for AUTOMATED, defaults to the tenant's contact email. */
  recipientEmail: z.string().max(254).optional(),
});
export type DeliveryChoiceInput = z.infer<typeof deliveryChoiceSchema>;

/**
 * The generated cross-account onboarding bundle. `templateBody` is the literal
 * CloudFormation YAML the admin either copies or emails to the customer.
 */
export const onboardingTemplateSchema = z.object({
  tenantId: uuidField,
  stackName: z.string(),
  roleArn: z.string(),
  roleNames: z.array(z.string()),
  externalId: z.string(),
  templateBody: z.string(),
  /** Human-readable instructions rendered in the wizard and in the email. */
  instructions: z.string(),
  launchUrl: z.string().nullable(),
  generatedAt: z.iso.datetime(),
});
export type OnboardingTemplate = z.infer<typeof onboardingTemplateSchema>;

export const generateTemplateInputSchema = z.object({
  /** Defaults to the tenant's configured region when omitted. */
  region: z.string().max(32).optional(),
});
export type GenerateTemplateInput = z.infer<typeof generateTemplateInputSchema>;

export const testConnectionInputSchema = z.object({
  awsAccountId: awsAccountIdSchema,
  /** Defaults to the role ARN derived from the tenant's ExternalId + region. */
  roleArn: z.string().max(512).optional(),
});
export type TestConnectionInput = z.infer<typeof testConnectionInputSchema>;

export const testConnectionResultSchema = z.object({
  ok: z.boolean(),
  accountId: z.string().nullable(),
  assumedRoleArn: z.string().nullable(),
  callerIdentity: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  latencyMs: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  /** Guardrail/permission probes performed with the temporary credentials. */
  probes: z.array(
    z.object({
      name: z.string(),
      ok: z.boolean(),
      detail: z.string().nullable(),
    }),
  ),
});
export type TestConnectionResult = z.infer<typeof testConnectionResultSchema>;

export const assignGovernanceInputSchema = z.object({
  guardrailKeys: z.array(z.string().min(1).max(120)).max(100).default([]),
  templateKeys: z.array(z.string().min(1).max(120)).max(100).default([]),
  scpPolicyIds: z.array(uuidField).max(100).default([]),
  /** When true the tenant is promoted to ACTIVE at the end of the step. */
  activateTenant: z.boolean().default(true),
});
export type AssignGovernanceInput = z.infer<typeof assignGovernanceInputSchema>;

export const onboardingStateSchema = z.object({
  tenant: tenantSummarySchema,
  currentStep: z.enum(ONBOARDING_STEPS),
  completedSteps: z.array(z.enum(ONBOARDING_STEPS)),
  canVerify: z.boolean(),
  template: onboardingTemplateSchema.nullable(),
  lastConnectionTest: testConnectionResultSchema.nullable(),
  availableDeliveryMethods: z.array(z.enum(DELIVERY_METHODS)),
});
export type OnboardingState = z.infer<typeof onboardingStateSchema>;
