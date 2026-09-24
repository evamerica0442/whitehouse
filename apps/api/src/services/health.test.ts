import { describe, expect, it } from 'vitest';

import { compliancePercent, computeHealth, summarizeStates, type ComplianceCounts } from './health';

function counts(overrides: Partial<ComplianceCounts> = {}): ComplianceCounts {
  return {
    status: 'ACTIVE',
    evaluated: 0,
    compliant: 0,
    nonCompliantCritical: 0,
    nonCompliantOther: 0,
    unknown: 0,
    ...overrides,
  };
}

describe('computeHealth', () => {
  it('is RED while a tenant is still onboarding, regardless of controls', () => {
    expect(computeHealth(counts({ status: 'TEMPLATE_SENT', compliant: 5, evaluated: 5 }))).toBe('RED');
    expect(computeHealth(counts({ status: 'AWAITING_VERIFICATION' }))).toBe('RED');
  });

  it('is RED when a high or critical control fails', () => {
    expect(
      computeHealth(counts({ evaluated: 5, compliant: 4, nonCompliantCritical: 1 })),
    ).toBe('RED');
  });

  it('is YELLOW for lower-severity failures', () => {
    expect(computeHealth(counts({ evaluated: 5, compliant: 4, nonCompliantOther: 1 }))).toBe('YELLOW');
  });

  it('treats unevaluated controls as YELLOW, never as a pass', () => {
    expect(computeHealth(counts({ evaluated: 3, compliant: 3, unknown: 0 }))).toBe('GREEN');
    expect(computeHealth(counts({ evaluated: 3, compliant: 2, unknown: 1 }))).toBe('YELLOW');
  });

  it('is YELLOW for an active tenant with no controls assigned', () => {
    expect(computeHealth(counts())).toBe('YELLOW');
  });

  it('is GREEN only when every evaluated control passes', () => {
    expect(computeHealth(counts({ evaluated: 4, compliant: 4 }))).toBe('GREEN');
  });
});

describe('summarizeStates', () => {
  it('splits non-compliance by severity and ignores NOT_APPLICABLE from the pass count', () => {
    const summary = summarizeStates([
      { state: 'COMPLIANT', severity: 'LOW' },
      { state: 'NON_COMPLIANT', severity: 'CRITICAL' },
      { state: 'NON_COMPLIANT', severity: 'LOW' },
      { state: 'UNKNOWN', severity: 'HIGH' },
      { state: 'NOT_APPLICABLE', severity: 'LOW' },
    ]);

    expect(summary.evaluated).toBe(5);
    expect(summary.compliant).toBe(1);
    expect(summary.nonCompliantCritical).toBe(1);
    expect(summary.nonCompliantOther).toBe(1);
    expect(summary.unknown).toBe(1);
  });
});

describe('compliancePercent', () => {
  it('is 0 when nothing is evaluated', () => {
    expect(compliancePercent({ evaluated: 0, compliant: 0 })).toBe(0);
  });

  it('rounds to one decimal place', () => {
    expect(compliancePercent({ evaluated: 3, compliant: 1 })).toBe(33.3);
    expect(compliancePercent({ evaluated: 8, compliant: 7 })).toBe(87.5);
  });
});
