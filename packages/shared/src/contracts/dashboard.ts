import { z } from 'zod';

import { AUDIT_ACTIONS, AUDIT_OUTCOMES, TENANT_STATUSES } from '../enums';
import { paginationMetaSchema, paginationQuerySchema, uuidField } from './common';
import { healthIndicatorSchema } from './tenant';

export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export const auditOutcomeSchema = z.enum(AUDIT_OUTCOMES);

export const auditLogEntrySchema = z.object({
  id: uuidField,
  actorUserId: uuidField.nullable(),
  actorEmail: z.string().nullable(),
  tenantId: uuidField.nullable(),
  tenantName: z.string().nullable(),
  action: auditActionSchema,
  outcome: auditOutcomeSchema,
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
  ipAddress: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const auditLogQuerySchema = paginationQuerySchema.extend({
  tenantId: uuidField.optional(),
  actorUserId: uuidField.optional(),
  action: auditActionSchema.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditLogResponseSchema = z.object({
  items: z.array(auditLogEntrySchema),
  meta: paginationMetaSchema,
});
export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;

/** Module 4 — the single-pane-of-glass payload. */
export const dashboardSummarySchema = z.object({
  accounts: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    byStatus: z.record(z.enum(TENANT_STATUSES), z.number().int().nonnegative()),
  }),
  compliance: z.object({
    percent: z.number().min(0).max(100),
    green: z.number().int().nonnegative(),
    yellow: z.number().int().nonnegative(),
    red: z.number().int().nonnegative(),
  }),
  spend: z.object({
    monthToDateUsd: z.number(),
    previousMonthUsd: z.number().nullable(),
    currency: z.string(),
    byTenant: z.array(
      z.object({
        tenantId: uuidField,
        customerName: z.string(),
        amountUsd: z.number(),
        health: healthIndicatorSchema,
      }),
    ),
    lastRefreshedAt: z.iso.datetime().nullable(),
  }),
  onboarding: z.object({
    awaitingTemplate: z.number().int().nonnegative(),
    awaitingVerification: z.number().int().nonnegative(),
    notStarted: z.number().int().nonnegative(),
  }),
  alerts: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
      title: z.string(),
      detail: z.string(),
      tenantId: uuidField.nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
  generatedAt: z.iso.datetime(),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
