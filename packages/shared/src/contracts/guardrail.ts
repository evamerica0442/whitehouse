import { z } from 'zod';

import { COMPLIANCE_STATES, GUARDRAIL_CATEGORIES, GUARDRAIL_SEVERITIES } from '../enums';
import { uuidField } from './common';
import { healthIndicatorSchema } from './tenant';

export const guardrailSeveritySchema = z.enum(GUARDRAIL_SEVERITIES);
export const guardrailCategorySchema = z.enum(GUARDRAIL_CATEGORIES);
export const complianceStateSchema = z.enum(COMPLIANCE_STATES);

export const guardrailDefinitionSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  category: guardrailCategorySchema,
  severity: guardrailSeveritySchema,
  /** Control Tower control identifier when this maps to a managed control. */
  controlTowerControlId: z.string().nullable(),
  /** SCP/Config/CloudFormation mechanism used to enforce it. */
  enforcement: z.enum(['SCP', 'CONFIG_RULE', 'SERVICE_CONTROL', 'TAGGING']),
  isPrebuilt: z.boolean(),
});
export type GuardrailDefinition = z.infer<typeof guardrailDefinitionSchema>;

export const tenantGuardrailAssignmentSchema = z.object({
  id: uuidField,
  tenantId: uuidField,
  guardrailKey: z.string(),
  enabled: z.boolean(),
  state: complianceStateSchema,
  lastCheckedAt: z.iso.datetime().nullable(),
  detail: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type TenantGuardrailAssignment = z.infer<typeof tenantGuardrailAssignmentSchema>;

export const complianceSummarySchema = z.object({
  tenantId: uuidField,
  evaluated: z.number().int().nonnegative(),
  compliant: z.number().int().nonnegative(),
  nonCompliant: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  compliancePercent: z.number().min(0).max(100),
  health: healthIndicatorSchema,
  lastCheckedAt: z.iso.datetime().nullable(),
});
export type ComplianceSummary = z.infer<typeof complianceSummarySchema>;

export const complianceOverviewSchema = z.object({
  totals: z.object({
    tenants: z.number().int().nonnegative(),
    green: z.number().int().nonnegative(),
    yellow: z.number().int().nonnegative(),
    red: z.number().int().nonnegative(),
    compliancePercent: z.number().min(0).max(100),
  }),
  perTenant: z.array(complianceSummarySchema),
});
export type ComplianceOverview = z.infer<typeof complianceOverviewSchema>;
