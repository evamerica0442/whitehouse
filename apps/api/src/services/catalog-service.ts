import type {
  CatalogTemplate,
  TemplateDeployment,
  TemplateVersion,
} from '@whitehouse/shared';
import type { PrismaClient } from '@whitehouse/db';

import { AppError } from '../lib/errors';

/**
 * Module 3 — the pre-approved template catalog.
 *
 * Milestone 1 scope: publishing, versioning, the approval workflow, per-tenant
 * entitlements, and deployment history are all real. Actual provisioning into a
 * customer account (Service Catalog / CloudFormation calls) lands in Milestone 2;
 * until then a deploy request is recorded and clearly marked as not executed,
 * rather than pretending to have run.
 */

export async function listCatalogTemplates(
  prisma: PrismaClient,
  filter: { status?: CatalogTemplate['status'] } = {},
): Promise<CatalogTemplate[]> {
  const templates = await prisma.catalogTemplate.findMany({
    where: filter.status ? { status: filter.status } : {},
    include: {
      versions: { orderBy: { createdAt: 'desc' }, take: 1 },
      _count: { select: { versions: true } },
    },
    orderBy: { name: 'asc' },
  });

  return templates.map((template) => ({
    id: template.id,
    key: template.key,
    name: template.name,
    description: template.description,
    kind: template.kind,
    status: template.status,
    currentVersion: template.versions[0]?.version ?? null,
    versionCount: template._count.versions,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  }));
}

export async function listTemplateVersions(
  prisma: PrismaClient,
  templateKey: string,
): Promise<TemplateVersion[]> {
  const template = await prisma.catalogTemplate.findUnique({
    where: { key: templateKey },
    include: { versions: { orderBy: { createdAt: 'desc' } } },
  });

  if (!template) throw AppError.notFound('Template');

  return template.versions.map((version) => ({
    id: version.id,
    version: version.version,
    changelog: version.changelog,
    status: version.status,
    approvedByUserId: version.approvedByUserId,
    approvedAt: version.approvedAt?.toISOString() ?? null,
    createdAt: version.createdAt.toISOString(),
  }));
}

export async function listTenantDeployments(
  prisma: PrismaClient,
  tenantId: string,
): Promise<TemplateDeployment[]> {
  const deployments = await prisma.templateDeployment.findMany({
    where: { tenantId },
    include: { template: { select: { key: true } }, version: { select: { version: true } } },
    orderBy: { deployedAt: 'desc' },
  });

  return deployments.map((deployment) => ({
    id: deployment.id,
    tenantId: deployment.tenantId,
    templateId: deployment.templateId,
    templateKey: deployment.template.key,
    version: deployment.version.version,
    status: deployment.status,
    stackName: deployment.stackName,
    deployedByUserId: deployment.deployedByUserId,
    message: deployment.message,
    deployedAt: deployment.deployedAt.toISOString(),
    updatedAt: deployment.updatedAt.toISOString(),
  }));
}

export async function listTenantTemplateAccess(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{ templateId: string; templateKey: string; templateName: string; grantedAt: string }[]> {
  const access = await prisma.tenantTemplateAccess.findMany({
    where: { tenantId },
    include: { template: { select: { key: true, name: true } } },
    orderBy: { grantedAt: 'desc' },
  });

  return access.map((row) => ({
    templateId: row.templateId,
    templateKey: row.template.key,
    templateName: row.template.name,
    grantedAt: row.grantedAt.toISOString(),
  }));
}
