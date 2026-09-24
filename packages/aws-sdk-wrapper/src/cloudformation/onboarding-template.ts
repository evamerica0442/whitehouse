import { CROSS_ACCOUNT_ROLES } from '@whitehouse/shared';

/**
 * Builds the CloudFormation template a customer deploys in *their* account to
 * grant the MSP scoped, revocable, auditable access.
 *
 * Design rules (see the project brief's architecture notes):
 *   - Two roles, least privilege: read-only for discovery/cost/guardrail checks,
 *     operator for provisioning and guardrail application.
 *   - Trust is limited to the MSP management account AND gated on a per-tenant
 *     ExternalId, so knowing an account ID alone is not enough to assume the
 *     role (confused-deputy protection). The ExternalId is generated per tenant
 *     and never reused.
 *   - No long-lived credentials are ever created or stored — only role ARNs.
 */

export interface OnboardingTemplateInput {
  /** MSP AWS management account that will assume the roles. */
  mspAccountId: string;
  /** 12-digit customer account ID when known; may be unknown at step 1. */
  customerAccountId?: string;
  /** Per-tenant ExternalId (confused-deputy guard). */
  externalId: string;
  /** Customer-visible name, used for stack naming and tags. */
  customerName: string;
  /** Region the template is intended for. */
  region: string;
  /** Optional: require MFA when the operator role is assumed. */
  requireMfaForOperator?: boolean;
  /** Optional stack name override; defaults to a slug derived from the customer name. */
  stackName?: string;
}

export interface OnboardingTemplateBundle {
  stackName: string;
  templateBody: string;
  /** Read-only role ARN — the value persisted on the tenant record. */
  roleArn: string;
  operatorRoleArn: string;
  roleNames: string[];
  externalId: string;
  /** Markdown instructions rendered in the wizard and emailed to the customer. */
  instructions: string;
}

export function slugifyStackName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `whitehouse-cloudguard-${slug || 'tenant'}`;
}

function allowStatement(actions: string[]) {
  return { Effect: 'Allow', Action: actions, Resource: '*' };
}

/** Services the read-only role may inspect for discovery + guardrail checks. */
export const READ_ONLY_ACTIONS = [
  'account:GetAccountInformation',
  'ce:GetCostAndUsage',
  'ce:GetCostForecast',
  'ce:GetDimensionValues',
  'cloudtrail:DescribeTrails',
  'cloudtrail:GetTrailStatus',
  'cloudwatch:DescribeAlarms',
  'cloudwatch:GetMetricStatistics',
  'config:DescribeConfigRules',
  'config:GetComplianceDetailsByConfigRule',
  'ec2:DescribeInstances',
  'ec2:DescribeSecurityGroups',
  'ec2:DescribeVolumes',
  'ec2:DescribeVpcs',
  'iam:GetAccountSummary',
  'iam:GetCredentialReport',
  'iam:ListRoles',
  'iam:ListUsers',
  'logs:DescribeLogGroups',
  'organizations:DescribeOrganization',
  'rds:DescribeDBInstances',
  's3:GetBucketLocation',
  's3:GetBucketPolicy',
  's3:GetBucketPublicAccessBlock',
  's3:ListAllMyBuckets',
  's3:ListBucket',
  'tag:GetResources',
];

/**
 * Actions the operator role may perform. Deliberately explicit rather than
 * wildcarded so a customer security review has something concrete to read.
 */
export const OPERATOR_ACTIONS = [
  'cloudformation:CreateStack',
  'cloudformation:CreateChangeSet',
  'cloudformation:DeleteStack',
  'cloudformation:DescribeStacks',
  'cloudformation:DescribeStackEvents',
  'cloudformation:GetTemplateSummary',
  'cloudformation:UpdateStack',
  'config:PutConfigRule',
  'config:DeleteConfigRule',
  'servicecatalog:DescribeProduct',
  'servicecatalog:ListProvisioningArtifacts',
  'servicecatalog:ProvisionProduct',
  'servicecatalog:TerminateProvisionedProduct',
  'servicecatalog:UpdateProvisionedProduct',
  'ssm:DescribeInstanceInformation',
  'ssm:GetParameter',
  'ssm:PutParameter',
  'ssm:SendCommand',
];

export function buildOnboardingTemplate(
  input: OnboardingTemplateInput,
): OnboardingTemplateBundle {
  const stackName = input.stackName ?? slugifyStackName(input.customerName);
  const roleNames = [CROSS_ACCOUNT_ROLES.readOnly, CROSS_ACCOUNT_ROLES.operator];

  const trustPolicy = (requireMfa: boolean) => ({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AllowMspAssumption',
        Effect: 'Allow',
        Principal: { AWS: `arn:aws:iam::${input.mspAccountId}:root` },
        Action: 'sts:AssumeRole',
        Condition: {
          StringEquals: { 'sts:ExternalId': input.externalId },
          ...(requireMfa ? { Bool: { 'aws:MultiFactorAuthPresent': 'true' } } : {}),
        },
      },
    ],
  });

  const tags = [
    { Key: 'msp:managed', Value: 'whitehouse-cloudguard' },
    { Key: 'msp:tenant', Value: input.customerName },
  ];

  const template = {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: `Whitehouse Cloudguard cross-account access for ${input.customerName}`,
    Parameters: {
      MspAccountId: {
        Type: 'String',
        Default: input.mspAccountId,
        Description: 'MSP management account that may assume these roles.',
        AllowedPattern: '^\\d{12}$',
        ConstraintDescription: 'Must be a 12-digit AWS account ID.',
      },
      ExternalId: {
        Type: 'String',
        Default: input.externalId,
        Description: 'Unique per-tenant token that prevents confused-deputy access.',
        MinLength: 16,
      },
    },
    Resources: {
      ReadOnlyRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: CROSS_ACCOUNT_ROLES.readOnly,
          Description: 'Whitehouse Cloudguard read-only discovery and cost role',
          AssumeRolePolicyDocument: trustPolicy(false),
          MaxSessionDuration: 3600,
          Policies: [
            {
              PolicyName: 'ReadOnlyDiscovery',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [allowStatement(READ_ONLY_ACTIONS)],
              },
            },
          ],
          Tags: tags,
        },
      },
      OperatorRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: CROSS_ACCOUNT_ROLES.operator,
          Description: 'Whitehouse Cloudguard operator role for provisioning and guardrails',
          AssumeRolePolicyDocument: trustPolicy(input.requireMfaForOperator ?? false),
          MaxSessionDuration: 3600,
          Policies: [
            {
              PolicyName: 'OperatorProvisioning',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [allowStatement(OPERATOR_ACTIONS)],
              },
            },
          ],
          Tags: tags,
        },
      },
    },
    Outputs: {
      ReadOnlyRoleArn: {
        Description: 'ARN of the read-only role the MSP assumes.',
        Value: { 'Fn::GetAtt': ['ReadOnlyRole', 'Arn'] },
        Export: { Name: `${stackName}-readonly-role-arn` },
      },
      OperatorRoleArn: {
        Description: 'ARN of the operator role the MSP assumes.',
        Value: { 'Fn::GetAtt': ['OperatorRole', 'Arn'] },
        Export: { Name: `${stackName}-operator-role-arn` },
      },
    },
  };

  const accountSegment = input.customerAccountId ?? '<CUSTOMER_ACCOUNT_ID>';
  const readOnlyRoleArn = `arn:aws:iam::${accountSegment}:role/${CROSS_ACCOUNT_ROLES.readOnly}`;

  return {
    stackName,
    templateBody: JSON.stringify(template, null, 2),
    roleArn: readOnlyRoleArn,
    operatorRoleArn: `arn:aws:iam::${accountSegment}:role/${CROSS_ACCOUNT_ROLES.operator}`,
    roleNames,
    externalId: input.externalId,
    instructions: buildInstructions({
      customerName: input.customerName,
      stackName,
      region: input.region,
      mspAccountId: input.mspAccountId,
      externalId: input.externalId,
    }),
  };
}

export function buildInstructions(params: {
  customerName: string;
  stackName: string;
  region: string;
  mspAccountId: string;
  externalId: string;
}): string {
  return [
    `## Grant Whitehouse Cloudguard access to ${params.customerName}`,
    '',
    'These steps create two scoped IAM roles in your AWS account. No user',
    'credentials or access keys are created, and you can revoke access at any',
    'time by deleting the stack.',
    '',
    '### 1. Deploy the stack',
    '1. Sign in to the AWS Console as an administrator.',
    '2. Open **CloudFormation -> Create stack -> With new resources**.',
    '3. Choose **Upload a template file** and upload the template provided with this request.',
    `4. Set the stack name to \`${params.stackName}\` and choose region \`${params.region}\`.`,
    `5. Confirm **MspAccountId** is \`${params.mspAccountId}\` and **ExternalId** is \`${params.externalId}\`.`,
    '6. Acknowledge the IAM resource creation notice, then create the stack.',
    '',
    '### 2. Send us the role ARN',
    'Once the stack status is `CREATE_COMPLETE`, copy the **ReadOnlyRoleArn** value',
    'from the stack Outputs tab and reply with it so we can verify access.',
    '',
    '### What these roles allow',
    '- **Read-only role**: inventory, cost, and compliance checks.',
    '- **Operator role**: deploy pre-approved templates and apply guardrails.',
    '',
    'Nothing else - no root access, no billing changes, no user management.',
  ].join('\n');
}

