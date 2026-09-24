import type { ComplianceState, HealthIndicator, TenantStatus } from '@whitehouse/shared';

/**
 * Compliance health rule, in one place so the dashboard, the tenant list, and
 * the guardrails page can never disagree.
 *
 *   RED    — the tenant is not fully onboarded, or a CRITICAL/HIGH control fails
 *   YELLOW — onboarded but partially compliant, or controls exist that we have
 *            not evaluated yet (an unknown control is not a pass)
 *   GREEN  — onboarded with every evaluated control compliant
 */
export interface ComplianceCounts {
  status: TenantStatus;
  evaluated: number;
  compliant: number;
  nonCompliantCritical: number;
  nonCompliantOther: number;
  unknown: number;
}

export function computeHealth(counts: ComplianceCounts): HealthIndicator {
  if (counts.status !== 'ACTIVE') return 'RED';
  if (counts.nonCompliantCritical > 0) return 'RED';
  if (counts.nonCompliantOther > 0) return 'YELLOW';
  if (counts.unknown > 0 || counts.evaluated === 0) return 'YELLOW';
  return 'GREEN';
}

export function compliancePercent(counts: Pick<ComplianceCounts, 'evaluated' | 'compliant'>): number {
  if (counts.evaluated === 0) return 0;
  return Math.round((counts.compliant / counts.evaluated) * 1000) / 10;
}

export function summarizeStates(
  states: readonly { state: ComplianceState; severity: string }[],
): Pick<ComplianceCounts, 'evaluated' | 'compliant' | 'nonCompliantCritical' | 'nonCompliantOther' | 'unknown'> {
  let compliant = 0;
  let nonCompliantCritical = 0;
  let nonCompliantOther = 0;
  let unknown = 0;

  for (const { state, severity } of states) {
    switch (state) {
      case 'COMPLIANT':
        compliant += 1;
        break;
      case 'NON_COMPLIANT':
        if (severity === 'CRITICAL' || severity === 'HIGH') nonCompliantCritical += 1;
        else nonCompliantOther += 1;
        break;
      case 'UNKNOWN':
        unknown += 1;
        break;
      case 'NOT_APPLICABLE':
        break;
    }
  }

  return {
    evaluated: states.length,
    compliant,
    nonCompliantCritical,
    nonCompliantOther,
    unknown,
  };
}
