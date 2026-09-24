import { describe, expect, it } from 'vitest';

import { buildOnboardingTemplate, slugifyStackName } from './onboarding-template';

const baseInput = {
  mspAccountId: '111122223333',
  externalId: 'abcdef0123456789abcdef0123456789',
  customerName: 'Northwind Trading Co',
  region: 'us-east-1',
};

describe('slugifyStackName', () => {
  it('produces a CloudFormation-safe stack name', () => {
    const name = slugifyStackName('Northwind Trading Co');
    expect(name).toBe('whitehouse-cloudguard-northwind-trading-co');
    expect(name).toMatch(/^[a-z0-9-]+$/);
  });

  it('keeps long customer names within the IAM/CloudFormation 64-char budget', () => {
    expect(slugifyStackName('A'.repeat(200)).length).toBeLessThanOrEqual(64);
    expect(slugifyStackName('Acme Industrie GmbH & Co. KG, München').length).toBeLessThanOrEqual(64);
  });

  it('never returns an empty suffix', () => {
    expect(slugifyStackName('***')).toBe('whitehouse-cloudguard-tenant');
  });
});

describe('buildOnboardingTemplate', () => {
  it('emits parseable JSON with both cross-account roles', () => {
    const bundle = buildOnboardingTemplate(baseInput);
    const template = JSON.parse(bundle.templateBody);

    expect(template.Resources.ReadOnlyRole).toBeDefined();
    expect(template.Resources.OperatorRole).toBeDefined();
    expect(bundle.roleNames).toHaveLength(2);
    expect(template.Outputs.ReadOnlyRoleArn).toBeDefined();
  });

  it('gates the trust policy on the MSP account and the per-tenant ExternalId', () => {
    const bundle = buildOnboardingTemplate(baseInput);
    const template = JSON.parse(bundle.templateBody);

    const assumeRolePolicy = template.Resources.ReadOnlyRole.Properties.AssumeRolePolicyDocument;
    expect(assumeRolePolicy.Statement[0].Principal.AWS).toBe('arn:aws:iam::111122223333:root');
    expect(assumeRolePolicy.Statement[0].Condition.StringEquals['sts:ExternalId']).toBe(
      baseInput.externalId,
    );
  });

  it('does not require MFA on the operator role unless asked', () => {
    const withoutMfa = JSON.parse(
      buildOnboardingTemplate(baseInput).templateBody,
    ).Resources.OperatorRole.Properties.AssumeRolePolicyDocument;
    expect(withoutMfa.Statement[0].Condition.Bool).toBeUndefined();

    const withMfa = JSON.parse(
      buildOnboardingTemplate({ ...baseInput, requireMfaForOperator: true }).templateBody,
    ).Resources.OperatorRole.Properties.AssumeRolePolicyDocument;
    expect(withMfa.Statement[0].Condition.Bool['aws:MultiFactorAuthPresent']).toBe('true');
  });

  it('scrubs the account ID placeholder until the customer supplies it', () => {
    const bundle = buildOnboardingTemplate(baseInput);
    expect(bundle.roleArn).toContain('<CUSTOMER_ACCOUNT_ID>');

    const withAccount = buildOnboardingTemplate({ ...baseInput, customerAccountId: '444455556666' });
    expect(withAccount.roleArn).toBe(
      'arn:aws:iam::444455556666:role/WhitehouseCloudGuard-ReadOnly',
    );
  });

  it('never grants wildcard administrative actions to the operator role', () => {
    const template = JSON.parse(buildOnboardingTemplate(baseInput).templateBody);
    const statements = template.Resources.OperatorRole.Properties.Policies[0].PolicyDocument.Statement;

    for (const statement of statements) {
      expect(statement.Action).not.toContain('*');
      expect(statement.Resource).toBe('*'); // resource scope only, not action scope
    }
  });

  it('includes the ExternalId and MSP account in the customer instructions', () => {
    const bundle = buildOnboardingTemplate(baseInput);
    expect(bundle.instructions).toContain(baseInput.externalId);
    expect(bundle.instructions).toContain(baseInput.mspAccountId);
    expect(bundle.instructions).toContain('Northwind Trading Co');
  });
});
