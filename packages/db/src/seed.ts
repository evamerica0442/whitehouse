/**
 * Idempotent seed for local development and the free-tier demo environment.
 *
 * Deliberately does NOT create passwords: admin users are created passwordless
 * and authenticate via magic link, or an operator sets a password explicitly
 * with `npm run user:password -w @whitehouse/api`. Baking a known hash into
 * source control is how demo credentials end up in production.
 *
 * Run with: npm run db:seed
 */
import { randomBytes } from 'node:crypto';

import { config as loadEnv } from 'dotenv';

import { createPrismaClient } from './client';

loadEnv({ quiet: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to run the seed (use the pooled Neon URL).');
}

const prisma = createPrismaClient({ connectionString, logQueries: false });

/** Per-tenant confused-deputy token, same shape the API generates. */
function generateExternalId(): string {
  return randomBytes(16).toString('hex');
}

const guardrails = [
  {
    key: 'block-public-s3',
    name: 'Block public S3 buckets',
    description: 'Denies public ACLs and bucket policies on every S3 bucket.',
    category: 'SECURITY' as const,
    severity: 'HIGH' as const,
    enforcement: 'SCP' as const,
    controlTowerControlId: null,
    definition: {
      effect: 'Deny',
      actions: ['s3:PutBucketAcl', 's3:PutBucketPolicy'],
      condition: { StringEquals: { 's3:x-amz-acl': ['public-read', 'public-read-write'] } },
    },
  },
  {
    key: 'require-mfa',
    name: 'Require MFA for privileged actions',
    description: 'Denies sensitive IAM and Organizations actions unless MFA is present.',
    category: 'SECURITY' as const,
    severity: 'HIGH' as const,
    enforcement: 'SCP' as const,
    controlTowerControlId: null,
    definition: {
      effect: 'Deny',
      actions: ['organizations:*', 'iam:DeleteUser', 'iam:CreateAccessKey'],
      condition: { BoolIfExists: { 'aws:MultiFactorAuthPresent': 'false' } },
    },
  },
  {
    key: 'enforce-encryption-at-rest',
    name: 'Enforce encryption at rest',
    description: 'Flags RDS, EBS, and S3 resources that are not encrypted with a KMS key.',
    category: 'ENCRYPTION' as const,
    severity: 'HIGH' as const,
    enforcement: 'CONFIG_RULE' as const,
    controlTowerControlId: 'AWS-GR_ENCRYPTED_VOLUMES',
    definition: { configRule: 'ENCRYPTED_VOLUMES', resourceTypes: ['AWS::EC2::Volume'] },
  },
  {
    key: 'centralize-cloudtrail',
    name: 'Centralize audit logging to the MSP trail',
    description: 'Requires an organization-wide CloudTrail delivering to the MSP log archive.',
    category: 'LOGGING' as const,
    severity: 'MEDIUM' as const,
    enforcement: 'CONFIG_RULE' as const,
    controlTowerControlId: 'AWS-GR_CLOUDTRAIL_ENABLED',
    definition: { configRule: 'CLOUD_TRAIL_ENABLED', organizationTrail: true },
  },
  {
    key: 'restrict-public-ingress',
    name: 'Restrict public ingress',
    description: 'Denies security group ingress rules exposing 0.0.0.0/0 on non-allowlisted ports.',
    category: 'NETWORK' as const,
    severity: 'CRITICAL' as const,
    enforcement: 'SCP' as const,
    controlTowerControlId: null,
    definition: { effect: 'Deny', actions: ['ec2:AuthorizeSecurityGroupIngress'], allowlist: [443] },
  },
  {
    key: 'deny-leaving-organization',
    name: 'Prevent accounts leaving the organization',
    description: 'Blocks a member account from removing itself from the MSP organization.',
    category: 'SECURITY' as const,
    severity: 'CRITICAL' as const,
    enforcement: 'SCP' as const,
    controlTowerControlId: null,
    definition: { effect: 'Deny', actions: ['organizations:LeaveOrganization'] },
  },
  {
    key: 'require-cost-allocation-tags',
    name: 'Require cost allocation tags',
    description: 'Flags resources missing the msp:tenant cost allocation tag.',
    category: 'COST' as const,
    severity: 'LOW' as const,
    enforcement: 'TAGGING' as const,
    controlTowerControlId: null,
    definition: { requiredTags: ['msp:tenant', 'msp:environment'] },
  },
];

const scpPolicies = [
  {
    name: 'baseline-guardrails',
    description: 'Protects the guardrail enforcement mechanisms from being disabled.',
    document: {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'ProtectGuardrails',
          Effect: 'Deny',
          Action: [
            'cloudtrail:StopLogging',
            'cloudtrail:DeleteTrail',
            'config:DeleteDetector',
            'config:StopConfigurationRecorder',
          ],
          Resource: '*',
        },
      ],
    },
  },
  {
    name: 'region-lock',
    description: 'Restricts resource creation to MSP-approved regions for this tenant.',
    document: {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'DenyOutsideApprovedRegions',
          Effect: 'Deny',
          NotAction: ['iam:*', 'sts:*', 'organizations:*', 'cloudfront:*', 'support:*'],
          Resource: '*',
          Condition: {
            StringNotEquals: {
              'aws:RequestedRegion': ['us-east-1', 'us-west-2', 'eu-west-1'],
            },
          },
        },
      ],
    },
  },
];

const catalogTemplates = [
  {
    key: 'standard-vpc',
    name: 'Standard MSP VPC',
    description:
      'Three-tier VPC with private/public subnets, NAT gateways, and VPC flow logs enabled.',
    version: '1.0.0',
    body: [
      'AWSTemplateFormatVersion: "2010-09-09"',
      'Description: Whitehouse Cloudguard standard VPC',
      'Parameters:',
      '  Environment:',
      '    Type: String',
      '    AllowedValues: [production, staging, development]',
      'Resources:',
      '  FlowLogBucket:',
      '    Type: AWS::S3::Bucket',
      '    Properties:',
      '      BucketEncryption:',
      '        ServerSideEncryptionConfiguration:',
      '          - ServerSideEncryptionByDefault:',
      '              SSEAlgorithm: aws:kms',
      '  Vpc:',
      '    Type: AWS::EC2::VPC',
      '    Properties:',
      '      CidrBlock: 10.0.0.0/16',
      '      EnableDnsSupport: true',
      '      EnableDnsHostnames: true',
      '      Tags:',
      '        - Key: msp:environment',
      '          Value: !Ref Environment',
    ].join('\n'),
  },
  {
    key: 'backup-policy',
    name: 'Standard Backup Policy',
    description: 'AWS Backup vault with a 35-day daily retention plan.',
    version: '1.0.0',
    body: [
      'AWSTemplateFormatVersion: "2010-09-09"',
      'Description: Whitehouse Cloudguard standard backup policy',
      'Resources:',
      '  BackupVault:',
      '    Type: AWS::Backup::BackupVault',
      '    Properties:',
      '      BackupVaultName: msp-standard-vault',
      '  BackupPlan:',
      '    Type: AWS::Backup::BackupPlan',
      '    Properties:',
      '      BackupPlan:',
      '        BackupPlanName: msp-daily-35d',
      '        BackupPlanRule:',
      '          - RuleName: daily',
      '            TargetBackupVault: !Ref BackupVault',
      '            ScheduleExpression: cron(0 5 * * ? *)',
      '            Lifecycle:',
      '              DeleteAfterDays: 35',
    ].join('\n'),
  },
];

const demoUsers = [
  { email: 'admin@whitehouse.example', name: 'MSP Super Admin', role: 'SUPER_ADMIN' as const },
  { email: 'engineer@whitehouse.example', name: 'MSP Engineer', role: 'ENGINEER' as const },
  { email: 'readonly@whitehouse.example', name: 'MSP Read-only', role: 'READ_ONLY' as const },
];

const demoTenants = [
  {
    customerName: 'Northwind Trading Co',
    contactName: 'Ada Lovelace',
    contactEmail: 'cloud@northwind.example',
    environment: 'PRODUCTION' as const,
    region: 'us-east-1',
    awsAccountId: '444455556666',
    status: 'ACTIVE' as const,
  },
  {
    customerName: 'Contoso Logistics',
    contactName: 'Grace Hopper',
    contactEmail: 'infra@contoso.example',
    environment: 'PRODUCTION' as const,
    region: 'eu-west-1',
    awsAccountId: null,
    status: 'TEMPLATE_SENT' as const,
  },
  {
    customerName: 'Fabrikam Health',
    contactName: null,
    contactEmail: 'it@fabrikam.example',
    environment: 'STAGING' as const,
    region: 'us-west-2',
    awsAccountId: null,
    status: 'NOT_STARTED' as const,
  },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function seedGuardrails(): Promise<number> {
  for (const guardrail of guardrails) {
    await prisma.guardrail.upsert({
      where: { key: guardrail.key },
      create: {
        key: guardrail.key,
        name: guardrail.name,
        description: guardrail.description,
        category: guardrail.category,
        severity: guardrail.severity,
        enforcement: guardrail.enforcement,
        controlTowerControlId: guardrail.controlTowerControlId,
        definition: guardrail.definition as never,
      },
      update: {
        name: guardrail.name,
        description: guardrail.description,
        category: guardrail.category,
        severity: guardrail.severity,
        enforcement: guardrail.enforcement,
        controlTowerControlId: guardrail.controlTowerControlId,
        definition: guardrail.definition as never,
      },
    });
  }
  return guardrails.length;
}

async function seedScpPolicies(): Promise<number> {
  for (const policy of scpPolicies) {
    await prisma.scpPolicy.upsert({
      where: { name: policy.name },
      create: {
        name: policy.name,
        description: policy.description,
        document: policy.document as never,
      },
      update: { description: policy.description, document: policy.document as never },
    });
  }
  return scpPolicies.length;
}

async function seedCatalogTemplates(): Promise<number> {
  for (const template of catalogTemplates) {
    const record = await prisma.catalogTemplate.upsert({
      where: { key: template.key },
      create: {
        key: template.key,
        name: template.name,
        description: template.description,
        kind: 'CLOUDFORMATION',
        // Seed data is pre-approved so the onboarding wizard has something grantable.
        status: 'APPROVED',
      },
      update: { name: template.name, description: template.description, status: 'APPROVED' },
    });

    await prisma.templateVersion.upsert({
      where: { templateId_version: { templateId: record.id, version: template.version } },
      create: {
        templateId: record.id,
        version: template.version,
        body: template.body,
        status: 'APPROVED',
        approvedAt: new Date(),
        changelog: 'Initial standard published by the platform team',
      },
      update: { body: template.body, status: 'APPROVED' },
    });
  }
  return catalogTemplates.length;
}

async function seedUsers(): Promise<number> {
  for (const user of demoUsers) {
    await prisma.user.upsert({
      where: { email: user.email },
      // Password-neutral by design: set one with `npm run user:password`.
      create: { email: user.email, name: user.name, role: user.role },
      update: { name: user.name, role: user.role },
    });
  }
  return demoUsers.length;
}

/**
 * Seeds the three demo tenants, one per onboarding stage, so the dashboard, the
 * pipeline counters and the wizard can all be exercised without a real customer
 * account. The ACTIVE tenant also gets a cost snapshot and an audit trail, which is
 * what makes the tenant list show spend and "last verified".
 */
async function seedTenants(): Promise<number> {
  for (const tenant of demoTenants) {
    const slug = slugify(tenant.customerName);
    const externalId = generateExternalId();
    const roleArn = tenant.awsAccountId
      ? `arn:aws:iam::${tenant.awsAccountId}:role/WhitehouseCloudGuard-ReadOnly`
      : null;
    const isActive = tenant.status === 'ACTIVE';

    const record = await prisma.tenant.upsert({
      where: { slug },
      create: {
        slug,
        customerName: tenant.customerName,
        contactName: tenant.contactName,
        contactEmail: tenant.contactEmail,
        environment: tenant.environment,
        region: tenant.region,
        status: tenant.status,
        awsAccountId: tenant.awsAccountId,
        roleArn,
        externalId,
        health: isActive ? 'GREEN' : 'RED',
        onboardedAt: isActive ? new Date() : null,
        lastVerifiedAt: isActive ? new Date() : null,
      },
      update: {
        customerName: tenant.customerName,
        contactName: tenant.contactName,
        contactEmail: tenant.contactEmail,
        environment: tenant.environment,
        region: tenant.region,
        status: tenant.status,
        awsAccountId: tenant.awsAccountId,
        roleArn,
      },
    });

    if (isActive && tenant.awsAccountId) {
      await seedActiveTenant(record.id, tenant.awsAccountId);
    }

    if (tenant.status === 'TEMPLATE_SENT') {
      const delivered = await prisma.onboardingDelivery.findFirst({
        where: { tenantId: record.id, method: 'AUTOMATED', status: 'SENT' },
      });

      if (!delivered) {
        await prisma.onboardingDelivery.create({
          data: {
            tenantId: record.id,
            method: 'AUTOMATED',
            status: 'SENT',
            recipient: tenant.contactEmail,
            subject: `Action required: grant Whitehouse Cloudguard access to ${tenant.customerName}`,
            providerMessageId: 'seed-message-id',
            attemptedAt: new Date(),
          },
        });
      }
    }
  }

  return demoTenants.length;
}

async function seedActiveTenant(tenantId: string, accountId: string): Promise<void> {
  const [library, templates, existingSnapshot, existingAudit] = await Promise.all([
    prisma.guardrail.findMany({ select: { id: true }, take: 4 }),
    prisma.catalogTemplate.findMany({ select: { id: true }, take: 2 }),
    prisma.costSnapshot.findFirst({ where: { tenantId } }),
    prisma.auditLog.findFirst({ where: { tenantId, action: 'ONBOARDING_COMPLETED' } }),
  ]);

  if (library.length > 0) {
    await prisma.tenantGuardrail.createMany({
      data: library.map((guardrail) => ({
        tenantId,
        guardrailId: guardrail.id,
        enabled: true,
        state: 'COMPLIANT' as const,
        lastCheckedAt: new Date(),
        detail: 'Seeded as compliant so the demo dashboard shows a green tenant.',
      })),
      skipDuplicates: true,
    });
  }

  if (templates.length > 0) {
    await prisma.tenantTemplateAccess.createMany({
      data: templates.map((template) => ({ tenantId, templateId: template.id })),
      skipDuplicates: true,
    });
  }

  if (!existingSnapshot) {
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    await prisma.costSnapshot.create({
      data: {
        tenantId,
        periodStart,
        periodEnd,
        granularity: 'DAILY',
        currency: 'USD',
        total: 4821.37,
        byService: [
          { service: 'Amazon Elastic Compute Cloud - Compute', amount: 1639.27 },
          { service: 'Amazon Relational Database Service', amount: 1012.49 },
          { service: 'Amazon Simple Storage Service', amount: 674.99 },
          { service: 'AWS Lambda', amount: 433.92 },
          { service: 'Amazon CloudWatch', amount: 337.5 },
          { service: 'AWS Key Management Service', amount: 144.64 },
          { service: 'Amazon Route 53', amount: 192.86 },
          { service: 'Amazon Elastic Container Service', amount: 385.7 },
        ] as never,
        byDay: [
          { date: periodStart.toISOString().slice(0, 10), amount: 4120.19 },
          { date: periodEnd.toISOString().slice(0, 10), amount: 701.18 },
        ] as never,
        source: 'MOCK',
        fetchedAt: new Date(),
      },
    });
  }

  if (!existingAudit) {
    // A recorded verification is what unlocks activation and shows "last verified".
    await prisma.auditLog.createMany({
      data: [
        {
          tenantId,
          action: 'TENANT_CREATED',
          outcome: 'SUCCESS',
          actorEmail: 'admin@whitehouse.example',
          targetType: 'tenant',
          targetId: tenantId,
        },
        {
          tenantId,
          action: 'ONBOARDING_TEMPLATE_GENERATED',
          outcome: 'SUCCESS',
          actorEmail: 'admin@whitehouse.example',
          targetType: 'cloudformation_template',
          targetId: 'whitehouse-cloudguard-northwind-trading-co',
          detail: { seeded: true, accountId } as never,
        },
        {
          tenantId,
          action: 'ONBOARDING_CONNECTION_VERIFIED',
          outcome: 'SUCCESS',
          actorEmail: 'engineer@whitehouse.example',
          targetType: 'cross_account_role',
          targetId: `arn:aws:iam::${accountId}:role/WhitehouseCloudGuard-ReadOnly`,
          detail: {
            ok: true,
            accountId,
            assumedRoleArn: `arn:aws:iam::${accountId}:role/WhitehouseCloudGuard-ReadOnly`,
            callerIdentity: `arn:aws:sts::${accountId}:assumed-role/WhitehouseCloudGuard-ReadOnly/whitehouse-seed`,
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            latencyMs: 132,
            errorCode: null,
            errorMessage: null,
            probes: [
              { name: 'sts:GetCallerIdentity', ok: true, detail: 'seeded' },
              { name: 'organizations:DescribeAccount', ok: true, detail: 'seeded' },
            ],
          } as never,
        },
        {
          tenantId,
          action: 'ONBOARDING_COMPLETED',
          outcome: 'SUCCESS',
          actorEmail: 'engineer@whitehouse.example',
          targetType: 'tenant',
          targetId: tenantId,
        },
      ],
    });
  }
}

async function main(): Promise<void> {
  const guardrailCount = await seedGuardrails();
  const scpCount = await seedScpPolicies();
  const templateCount = await seedCatalogTemplates();
  const userCount = await seedUsers();
  const tenantCount = await seedTenants();

  console.log(
    [
      'Seed complete.',
      `  users:        ${userCount} (no passwords — set one with \`npm run user:password -w @whitehouse/api\`)`,
      `  guardrails:   ${guardrailCount}`,
      `  scp policies: ${scpCount}`,
      `  templates:    ${templateCount}`,
      `  tenants:      ${tenantCount}`,
      '',
      'Demo accounts: admin@whitehouse.example · engineer@whitehouse.example · readonly@whitehouse.example',
    ].join('\n'),
  );
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });




