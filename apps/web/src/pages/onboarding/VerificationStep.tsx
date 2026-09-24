import { useState } from 'react';
import type { OnboardingState, TestConnectionResult } from '@whitehouse/shared';

import { useTenantMutations } from '@/auth/AuthProvider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { formatDateTime } from '@/lib/format';

/**
 * Step 4 — Test Connection.
 *
 * This is the gate that stops a tenant being marked Active on the strength of an
 * untested role: the API performs a live STS AssumeRole (with forceRefresh) plus
 * free-to-call permission probes, and refuses activation until it succeeds.
 */
export function VerificationStep({ tenantId, state }: { tenantId: string; state: OnboardingState }) {
  const { verifyConnection } = useTenantMutations(tenantId);

  const [accountId, setAccountId] = useState(state.tenant.awsAccountId ?? '');
  const [roleArn, setRoleArn] = useState(state.tenant.roleArn ?? '');
  const [result, setResult] = useState<TestConnectionResult | null>(state.lastConnectionTest);
  const [error, setError] = useState<string | null>(null);

  if (!state.template) return null;

  const run = async () => {
    setError(null);
    try {
      const response = await verifyConnection.mutateAsync({
        awsAccountId: accountId,
        ...(roleArn ? { roleArn } : {}),
      });
      setResult(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Test Connection could not run');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>3 · Test connection</CardTitle>
        <CardDescription>
          Assumes the read-only role with the tenant&apos;s ExternalId and confirms the session with
          STS GetCallerIdentity. Nothing is cached for this check.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Customer AWS account ID"
            htmlFor="accountId"
            hint="12 digits, from the customer's account page."
          >
            <Input
              id="accountId"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              placeholder="444455556666"
              inputMode="numeric"
            />
          </Field>

          <Field
            label="Role ARN (optional)"
            htmlFor="roleArn"
            hint="Leave blank to use the standard read-only role name."
          >
            <Input
              id="roleArn"
              value={roleArn}
              onChange={(event) => setRoleArn(event.target.value)}
              placeholder="arn:aws:iam::444455556666:role/WhitehouseCloudGuard-ReadOnly"
            />
          </Field>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Test could not run</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {result ? (
          <Alert variant={result.ok ? 'success' : 'destructive'}>
            <AlertTitle>
              {result.ok ? 'Connection verified' : `Connection failed (${result.errorCode ?? 'unknown'})`}
            </AlertTitle>
            <AlertDescription>
              {result.ok ? (
                <ul className="mt-1 space-y-1 text-sm">
                  <li>
                    Account: <code>{result.accountId}</code>
                  </li>
                  <li>
                    Caller: <code>{result.callerIdentity}</code>
                  </li>
                  <li>Round trip: {result.latencyMs} ms</li>
                  <li>Session expires: {formatDateTime(result.expiresAt)}</li>
                </ul>
              ) : (
                <p className="mt-1 text-sm">{result.errorMessage}</p>
              )}

              {result.probes.length > 0 ? (
                <ul className="mt-3 space-y-1 text-xs">
                  {result.probes.map((probe) => (
                    <li key={probe.name}>
                      <span className={probe.ok ? 'text-success' : 'text-destructive'}>
                        {probe.ok ? '✓' : '✕'}
                      </span>{' '}
                      <code>{probe.name}</code>
                      {probe.detail ? (
                        <span className="text-muted-foreground"> — {probe.detail}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <Button
          onClick={run}
          isLoading={verifyConnection.isPending}
          disabled={!/^\d{12}$/.test(accountId)}
        >
          Test connection
        </Button>
      </CardContent>
    </Card>
  );
}
