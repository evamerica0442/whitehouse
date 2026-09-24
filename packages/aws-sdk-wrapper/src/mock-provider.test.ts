import type { CrossAccountRef } from '@whitehouse/shared';
import { describe, expect, it } from 'vitest';

import { MockCloudProvider } from './mock-provider';

const provider = new MockCloudProvider(0);

const baseRef: CrossAccountRef = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  accountId: '444455556666',
  roleArn: 'arn:aws:iam::444455556666:role/WhitehouseCloudGuard-ReadOnly',
  externalId: 'abcdef0123456789abcdef0123456789',
  region: 'us-east-1',
};

describe('MockCloudProvider.verifyCrossAccountAccess', () => {
  it('succeeds and reports the assumed role identity', async () => {
    const result = await provider.verifyCrossAccountAccess(baseRef);

    expect(result.ok).toBe(true);
    expect(result.accountId).toBe(baseRef.accountId);
    expect(result.callerIdentity).toContain('assumed-role/WhitehouseCloudGuard-ReadOnly');
    expect(result.errorCode).toBeNull();
  });

  it('fails with an AccessDenied code when the ExternalId does not match', async () => {
    const result = await provider.verifyCrossAccountAccess({
      ...baseRef,
      externalId: 'invalid-external-id-000000000000',
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('ASSUME_ROLE_ACCESS_DENIED');
    expect(result.errorMessage).toContain('ExternalId');
  });

  it('fails when the customer never deployed the role', async () => {
    const result = await provider.verifyCrossAccountAccess({ ...baseRef, accountId: '123456780000' });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('ASSUME_ROLE_ACCESS_DENIED');
  });

  it('reports the round-trip latency used by the wizard', async () => {
    const result = await provider.verifyCrossAccountAccess(baseRef);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('MockCloudProvider.getCostAndUsage', () => {
  const query = { startDate: '2026-03-01', endDate: '2026-04-01', granularity: 'MONTHLY' as const };

  it('is deterministic for the same account, so demos and tests do not flake', async () => {
    const first = await provider.getCostAndUsage(baseRef, query);
    const second = await provider.getCostAndUsage(baseRef, query);

    expect(first.total).toBe(second.total);
    expect(first.byService).toEqual(second.byService);
  });

  it('varies by account so tenants are distinguishable', async () => {
    const other = await provider.getCostAndUsage({ ...baseRef, accountId: '999988887777' }, query);
    const ours = await provider.getCostAndUsage(baseRef, query);

    expect(other.total).not.toBe(ours.total);
  });

  it('returns one entry per day in the requested window', async () => {
    const breakdown = await provider.getCostAndUsage(baseRef, {
      startDate: '2026-03-01',
      endDate: '2026-03-08',
      granularity: 'DAILY',
    });

    expect(breakdown.byDay).toHaveLength(7);
    expect(breakdown.byDay[0]?.date).toBe('2026-03-01');
  });

  it('identifies itself as the mock driver so cost source is never ambiguous', () => {
    expect(provider.id).toBe('mock');
  });
});

describe('MockCloudProvider.runPermissionProbes', () => {
  it('reports probe results that mirror a healthy role', async () => {
    const probes = await provider.runPermissionProbes(baseRef);

    expect(probes.length).toBeGreaterThan(0);
    expect(probes.every((probe) => probe.ok)).toBe(true);
  });
});
