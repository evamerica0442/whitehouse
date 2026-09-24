import { z } from 'zod';

import {
  DELIVERY_METHODS,
  DELIVERY_STATUSES,
  ENVIRONMENT_TYPES,
  HEALTH_INDICATORS,
  TENANT_STATUSES,
} from '../enums';
import { SUPPORTED_REGIONS } from '../constants';
import { emailField, paginationMetaSchema, paginationQuerySchema, uuidField } from './common';

export const environmentTypeSchema = z.enum(ENVIRONMENT_TYPES);
export const regionSchema = z.enum(SUPPORTED_REGIONS);
export const tenantStatusSchema = z.enum(TENANT_STATUSES);
export const deliveryMethodSchema = z.enum(DELIVERY_METHODS);
export const deliveryStatusSchema = z.enum(DELIVERY_STATUSES);
export const healthIndicatorSchema = z.enum(HEALTH_INDICATORS);

export const awsAccountIdSchema = z
  .string()
  .regex(/^\d{12}$/, 'AWS account IDs must be exactly 12 digits');

export const createTenantInputSchema = z.object({
  customerName: z.string().min(2).max(120),
  contactName: z.string().min(1).max(120).optional(),
  contactEmail: emailField,
  environment: environmentTypeSchema.default('PRODUCTION'),
  region: regionSchema.default('us-east-1'),
  /** Usually unknown at step 1 — the customer supplies it after creating the role. */
  awsAccountId: awsAccountIdSchema.optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateTenantInput = z.infer<typeof createTenantInputSchema>;

export const updateTenantInputSchema = z.object({
  customerName: z.string().min(2).max(120).optional(),
  contactName: z.string().min(1).max(120).nullable().optional(),
  contactEmail: emailField.optional(),
  environment: environmentTypeSchema.optional(),
  region: regionSchema.optional(),
  awsAccountId: awsAccountIdSchema.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type UpdateTenantInput = z.infer<typeof updateTenantInputSchema>;

export const tenantSummarySchema = z.object({
  id: uuidField,
  slug: z.string(),
  customerName: z.string(),
  contactName: z.string().nullable(),
  contactEmail: z.string(),
  environment: environmentTypeSchema,
  region: z.string(),
  status: tenantStatusSchema,
  awsAccountId: z.string().nullable(),
  roleArn: z.string().nullable(),
  /** Never rendered directly — shown to the customer inside the CFN template. */
  externalId: z.string(),
  deliveryMethod: deliveryMethodSchema.nullable(),
  deliveryStatus: deliveryStatusSchema,
  deliveryRecipient: z.string().nullable(),
  deliveryAttemptedAt: z.iso.datetime().nullable(),
  deliveryError: z.string().nullable(),
  guardrailCount: z.number().int().nonnegative(),
  templateCount: z.number().int().nonnegative(),
  health: healthIndicatorSchema,
  monthlySpendUsd: z.number().nullable(),
  spendUpdatedAt: z.iso.datetime().nullable(),
  lastVerifiedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TenantSummary = z.infer<typeof tenantSummarySchema>;

export const tenantListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  status: tenantStatusSchema.optional(),
  environment: environmentTypeSchema.optional(),
  region: z.string().max(32).optional(),
  sort: z.enum(['createdAt', 'customerName', 'monthlySpendUsd', 'status']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});
export type TenantListQuery = z.infer<typeof tenantListQuerySchema>;

export const tenantListResponseSchema = z.object({
  items: z.array(tenantSummarySchema),
  meta: paginationMetaSchema,
});
export type TenantListResponse = z.infer<typeof tenantListResponseSchema>;
