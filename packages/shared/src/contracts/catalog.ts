import { z } from 'zod';

import { DEPLOYMENT_STATUSES, TEMPLATE_KINDS, TEMPLATE_STATUSES } from '../enums';
import { uuidField } from './common';

export const templateKindSchema = z.enum(TEMPLATE_KINDS);
export const templateStatusSchema = z.enum(TEMPLATE_STATUSES);
export const deploymentStatusSchema = z.enum(DEPLOYMENT_STATUSES);

export const templateVersionSchema = z.object({
  id: uuidField,
  version: z.string(),
  changelog: z.string().nullable(),
  status: templateStatusSchema,
  approvedByUserId: uuidField.nullable(),
  approvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type TemplateVersion = z.infer<typeof templateVersionSchema>;

export const catalogTemplateSchema = z.object({
  id: uuidField,
  key: z.string(),
  name: z.string(),
  description: z.string(),
  kind: templateKindSchema,
  status: templateStatusSchema,
  currentVersion: z.string().nullable(),
  versionCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CatalogTemplate = z.infer<typeof catalogTemplateSchema>;

export const templateDeploymentSchema = z.object({
  id: uuidField,
  tenantId: uuidField,
  templateId: uuidField,
  templateKey: z.string(),
  version: z.string(),
  status: deploymentStatusSchema,
  stackName: z.string(),
  deployedByUserId: uuidField.nullable(),
  message: z.string().nullable(),
  deployedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TemplateDeployment = z.infer<typeof templateDeploymentSchema>;
