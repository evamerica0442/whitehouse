-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ENGINEER', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('NOT_STARTED', 'TEMPLATE_SENT', 'AWAITING_VERIFICATION', 'ACTIVE');

-- CreateEnum
CREATE TYPE "EnvironmentType" AS ENUM ('PRODUCTION', 'STAGING', 'DEVELOPMENT', 'SANDBOX');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('MANUAL', 'AUTOMATED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('NOT_SENT', 'PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "HealthIndicator" AS ENUM ('GREEN', 'YELLOW', 'RED');

-- CreateEnum
CREATE TYPE "GuardrailCategory" AS ENUM ('SECURITY', 'LOGGING', 'ENCRYPTION', 'NETWORK', 'COST', 'RESILIENCE');

-- CreateEnum
CREATE TYPE "GuardrailSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "GuardrailEnforcement" AS ENUM ('SCP', 'CONFIG_RULE', 'SERVICE_CONTROL', 'TAGGING');

-- CreateEnum
CREATE TYPE "ComplianceState" AS ENUM ('COMPLIANT', 'NON_COMPLIANT', 'UNKNOWN', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('CLOUDFORMATION', 'CDK');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "CostGranularity" AS ENUM ('DAILY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "CostSource" AS ENUM ('COST_EXPLORER', 'MOCK');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('USER_LOGIN', 'USER_LOGIN_FAILED', 'USER_LOGOUT', 'USER_INVITED', 'TENANT_CREATED', 'TENANT_UPDATED', 'ONBOARDING_TEMPLATE_GENERATED', 'ONBOARDING_TEMPLATE_DELIVERED', 'ONBOARDING_CONNECTION_VERIFIED', 'ONBOARDING_COMPLETED', 'GUARDRAILS_ASSIGNED', 'COST_SNAPSHOT_REFRESHED', 'TEMPLATE_PUBLISHED', 'TEMPLATE_DEPLOYED');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ENGINEER',
    "passwordHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magic_links" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT NOT NULL,
    "environment" "EnvironmentType" NOT NULL DEFAULT 'PRODUCTION',
    "region" TEXT NOT NULL DEFAULT 'us-east-1',
    "status" "TenantStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "health" "HealthIndicator" NOT NULL DEFAULT 'RED',
    "awsAccountId" TEXT,
    "roleArn" TEXT,
    "externalId" TEXT NOT NULL,
    "organizationalUnitId" TEXT,
    "notes" TEXT,
    "onboardedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_deliveries" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "method" "DeliveryMethod" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'NOT_SENT',
    "recipient" TEXT,
    "subject" TEXT,
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentByUserId" UUID,
    "attemptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardrails" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "GuardrailCategory" NOT NULL,
    "severity" "GuardrailSeverity" NOT NULL,
    "enforcement" "GuardrailEnforcement" NOT NULL,
    "controlTowerControlId" TEXT,
    "definition" JSONB NOT NULL,
    "isPrebuilt" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardrails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_guardrails" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "guardrailId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "state" "ComplianceState" NOT NULL DEFAULT 'UNKNOWN',
    "detail" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "assignedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_guardrails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardrail_checks" (
    "id" UUID NOT NULL,
    "tenantGuardrailId" UUID NOT NULL,
    "state" "ComplianceState" NOT NULL,
    "detail" TEXT,
    "evaluatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardrail_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scp_policies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "isPrebuilt" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scp_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_scp_assignments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "scpPolicyId" UUID NOT NULL,
    "targetType" TEXT NOT NULL DEFAULT 'ACCOUNT',
    "attachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attachedByUserId" UUID,

    CONSTRAINT "tenant_scp_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_templates" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "TemplateKind" NOT NULL DEFAULT 'CLOUDFORMATION',
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_template_access" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "grantedByUserId" UUID,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_template_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_versions" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "parametersSchema" JSONB,
    "changelog" TEXT,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_deployments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'QUEUED',
    "stackName" TEXT NOT NULL,
    "parameters" JSONB,
    "message" TEXT,
    "deployedByUserId" UUID,
    "deployedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_snapshots" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "granularity" "CostGranularity" NOT NULL DEFAULT 'MONTHLY',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "total" DECIMAL(14,2) NOT NULL,
    "byService" JSONB NOT NULL,
    "byDay" JSONB NOT NULL,
    "source" "CostSource" NOT NULL DEFAULT 'MOCK',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "jobName" TEXT NOT NULL,
    "queueJobId" TEXT,
    "tenantId" UUID,
    "status" "JobRunStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "actorEmail" TEXT,
    "tenantId" UUID,
    "action" "AuditAction" NOT NULL,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "targetType" TEXT,
    "targetId" TEXT,
    "detail" JSONB,
    "ipAddress" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "magic_links_tokenHash_key" ON "magic_links"("tokenHash");

-- CreateIndex
CREATE INDEX "magic_links_userId_idx" ON "magic_links"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_externalId_key" ON "tenants"("externalId");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenants_environment_idx" ON "tenants"("environment");

-- CreateIndex
CREATE INDEX "tenants_region_idx" ON "tenants"("region");

-- CreateIndex
CREATE INDEX "tenants_awsAccountId_idx" ON "tenants"("awsAccountId");

-- CreateIndex
CREATE INDEX "onboarding_deliveries_tenantId_createdAt_idx" ON "onboarding_deliveries"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "guardrails_key_key" ON "guardrails"("key");

-- CreateIndex
CREATE INDEX "guardrails_category_idx" ON "guardrails"("category");

-- CreateIndex
CREATE INDEX "tenant_guardrails_tenantId_state_idx" ON "tenant_guardrails"("tenantId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_guardrails_tenantId_guardrailId_key" ON "tenant_guardrails"("tenantId", "guardrailId");

-- CreateIndex
CREATE INDEX "guardrail_checks_tenantGuardrailId_createdAt_idx" ON "guardrail_checks"("tenantGuardrailId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "scp_policies_name_key" ON "scp_policies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_scp_assignments_tenantId_scpPolicyId_key" ON "tenant_scp_assignments"("tenantId", "scpPolicyId");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_templates_key_key" ON "catalog_templates"("key");

-- CreateIndex
CREATE INDEX "catalog_templates_status_idx" ON "catalog_templates"("status");

-- CreateIndex
CREATE INDEX "tenant_template_access_tenantId_idx" ON "tenant_template_access"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_template_access_tenantId_templateId_key" ON "tenant_template_access"("tenantId", "templateId");

-- CreateIndex
CREATE INDEX "template_versions_status_idx" ON "template_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "template_versions_templateId_version_key" ON "template_versions"("templateId", "version");

-- CreateIndex
CREATE INDEX "template_deployments_tenantId_status_idx" ON "template_deployments"("tenantId", "status");

-- CreateIndex
CREATE INDEX "cost_snapshots_tenantId_fetchedAt_idx" ON "cost_snapshots"("tenantId", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "cost_snapshots_tenantId_periodStart_periodEnd_granularity_key" ON "cost_snapshots"("tenantId", "periodStart", "periodEnd", "granularity");

-- CreateIndex
CREATE INDEX "job_runs_tenantId_createdAt_idx" ON "job_runs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "job_runs_status_idx" ON "job_runs"("status");

-- CreateIndex
CREATE INDEX "job_runs_jobName_createdAt_idx" ON "job_runs"("jobName", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_deliveries" ADD CONSTRAINT "onboarding_deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_guardrails" ADD CONSTRAINT "tenant_guardrails_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_guardrails" ADD CONSTRAINT "tenant_guardrails_guardrailId_fkey" FOREIGN KEY ("guardrailId") REFERENCES "guardrails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardrail_checks" ADD CONSTRAINT "guardrail_checks_tenantGuardrailId_fkey" FOREIGN KEY ("tenantGuardrailId") REFERENCES "tenant_guardrails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_scp_assignments" ADD CONSTRAINT "tenant_scp_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_scp_assignments" ADD CONSTRAINT "tenant_scp_assignments_scpPolicyId_fkey" FOREIGN KEY ("scpPolicyId") REFERENCES "scp_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_template_access" ADD CONSTRAINT "tenant_template_access_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_template_access" ADD CONSTRAINT "tenant_template_access_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "catalog_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "catalog_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_deployments" ADD CONSTRAINT "template_deployments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_deployments" ADD CONSTRAINT "template_deployments_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "catalog_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_deployments" ADD CONSTRAINT "template_deployments_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "template_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_deployments" ADD CONSTRAINT "template_deployments_deployedByUserId_fkey" FOREIGN KEY ("deployedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_snapshots" ADD CONSTRAINT "cost_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

