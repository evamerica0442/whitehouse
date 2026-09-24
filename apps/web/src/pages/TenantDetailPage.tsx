import { canPerform } from '@whitehouse/shared';
import { ArrowRight, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import {
  useAuth,
  useTenant,
  useTenantGuardrails,
  useTenantMutations,
} from '@/auth/AuthProvider';
import { ErrorNotice, LoadingRows } from '@/components/EmptyState';
import {
  DeliveryStatusBadge,
  HealthIndicatorDot,
  TenantStatusBadge,
} from '@/components/StatusBadge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatDateTime, formatRelative, titleCase } from '@/lib/format';

/** Tenant detail: identity, cross-account access, governance, and cost. */
export function TenantDetailPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { user } = useAuth();

  const tenant = useTenant(tenantId);
  const guardrails = useTenantGuardrails(tenantId);
  const { refreshCost } = useTenantMutations(tenantId);

  if (tenant.isLoading) return <LoadingRows label="Loading tenant…" />;
  if (tenant.error) return <ErrorNotice message={(tenant.error as Error).message} />;
  if (!tenant.data) return null;

  const data = tenant.data;
  const canRefreshCost = user ? canPerform(user.role, 'cost:refresh') : false;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{data.customerName}</h1>
            <TenantStatusBadge status={data.status} />
            <HealthIndicatorDot health={data.health} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {titleCase(data.environment)} · {data.region} · slug <code>{data.slug}</code>
          </p>
        </div>

        <div className="flex gap-2">
          {data.status !== 'ACTIVE' && user && canPerform(user.role, 'onboarding:run') ? (
            <Link className={buttonVariants()} to={`/onboarding/${data.id}`}>
              Continue onboarding
              <ArrowRight className="size-4" />
            </Link>
          ) : null}
          {canRefreshCost ? (
            <Button
              variant="outline"
              onClick={() => refreshCost.mutate()}
              isLoading={refreshCost.isPending}
            >
              <RefreshCw className="size-4" />
              Refresh cost
            </Button>
          ) : null}
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cross-account access</CardTitle>
            <CardDescription>
              The platform never stores customer credentials — only the role it assumes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="AWS account ID" value={data.awsAccountId ?? 'Not captured yet'} mono />
            <DetailRow label="Read-only role ARN" value={data.roleArn ?? 'Not captured yet'} mono />
            <DetailRow label="External ID" value={data.externalId} mono />
            <DetailRow label="Last verified" value={formatDateTime(data.lastVerifiedAt)} />
            <DetailRow
              label="Last delivery"
              value={
                <span className="flex items-center gap-2">
                  <DeliveryStatusBadge status={data.deliveryStatus} />
                  {data.deliveryMethod ? <span>{titleCase(data.deliveryMethod)}</span> : null}
                  {data.deliveryRecipient ? (
                    <span className="text-muted-foreground">{data.deliveryRecipient}</span>
                  ) : null}
                </span>
              }
            />
            {data.deliveryError ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {data.deliveryError}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Commercials and contacts</CardTitle>
            <CardDescription>Cost comes from the snapshot cache, not a live API call.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow
              label="Month-to-date spend"
              value={formatCurrency(data.monthlySpendUsd)}
              hint={data.spendUpdatedAt ? `updated ${formatRelative(data.spendUpdatedAt)}` : undefined}
            />
            <DetailRow label="Guardrails assigned" value={String(data.guardrailCount)} />
            <DetailRow label="Templates deployed" value={String(data.templateCount)} />
            <DetailRow label="Contact" value={data.contactName ?? '—'} hint={data.contactEmail} />
            <DetailRow label="Created" value={formatDateTime(data.createdAt)} />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Assigned guardrails</CardTitle>
          <CardDescription>
            UNKNOWN means the control is assigned but not yet evaluated against the customer account
            — live evaluation arrives in Milestone 2.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Control</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Last checked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!guardrails.data || guardrails.data.items.length === 0 ? (
                <TableEmpty colSpan={3} message="No guardrails assigned yet." />
              ) : (
                guardrails.data.items.map((assignment) => (
                  <TableRow key={assignment.id}>
                    <TableCell className="font-mono text-xs">{assignment.guardrailKey}</TableCell>
                    <TableCell>{titleCase(assignment.state)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelative(assignment.lastCheckedAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  );
}

export function DetailRow({
  label,
  value,
  hint,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
        {hint ? <span className="ml-1 text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </div>
  );
}
