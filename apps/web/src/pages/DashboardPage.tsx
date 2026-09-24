import { canPerform, type DashboardSummary } from '@whitehouse/shared';
import { RefreshCw } from 'lucide-react';
import { Link } from 'react-router';

import { useAuth, useDashboard, useJobs, useRunDailyJobs } from '@/auth/AuthProvider';
import { ErrorNotice, LoadingRows } from '@/components/EmptyState';
import { HealthIndicatorDot } from '@/components/StatusBadge';
import { SpendCard, StatCard } from '@/components/StatCard';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { formatCurrency, formatRelative, titleCase } from '@/lib/format';

/**
 * Module 4 — single pane of glass.
 *
 * Everything here comes from Postgres (snapshots and aggregates): no Cost Explorer
 * or customer-account call happens inline, which keeps the page fast and the AWS
 * bill predictable.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const summary = useDashboard();
  const jobs = useJobs();
  const runDaily = useRunDailyJobs();

  if (summary.isLoading) return <LoadingRows label="Loading portfolio overview…" />;
  if (summary.error) return <ErrorNotice message={(summary.error as Error).message} />;
  if (!summary.data) return null;

  const data: DashboardSummary = summary.data;
  const criticalAlerts = data.alerts.filter((alert) => alert.severity === 'CRITICAL');
  const pipeline =
    data.onboarding.notStarted +
    data.onboarding.awaitingTemplate +
    data.onboarding.awaitingVerification;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operations dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {data.accounts.total} managed account{data.accounts.total === 1 ? '' : 's'} · generated{' '}
            {formatRelative(data.generatedAt)}
          </p>
        </div>

        {user && canPerform(user.role, 'job:run') ? (
          <Button variant="outline" onClick={() => runDaily.mutate()} isLoading={runDaily.isPending}>
            <RefreshCw className="size-4" />
            Run daily jobs now
          </Button>
        ) : null}
      </header>

      {criticalAlerts.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>{criticalAlerts.length} critical issue(s) need attention</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {criticalAlerts.slice(0, 5).map((alert) => (
                <li key={alert.id}>{alert.detail}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Managed accounts"
          value={String(data.accounts.total)}
          hint={`${data.accounts.active} active`}
        />
        <StatCard
          label="Compliance"
          value={`${data.compliance.percent}%`}
          hint={`${data.compliance.green} green · ${data.compliance.yellow} yellow · ${data.compliance.red} red`}
          tone={
            data.compliance.red > 0
              ? 'destructive'
              : data.compliance.yellow > 0
                ? 'warning'
                : 'success'
          }
        />
        <SpendCard
          monthToDateUsd={data.spend.monthToDateUsd}
          previousMonthUsd={data.spend.previousMonthUsd}
          currency={data.spend.currency}
          lastRefreshedAt={data.spend.lastRefreshedAt}
        />
        <StatCard
          label="Onboarding pipeline"
          value={String(pipeline)}
          hint={`${data.onboarding.awaitingVerification} awaiting verification · ${data.onboarding.awaitingTemplate} template sent`}
          tone={data.onboarding.awaitingVerification > 0 ? 'warning' : 'default'}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Spend by tenant (month to date)</CardTitle>
            <CardDescription>
              Read from the cost snapshot cache. Cost Explorer bills per request, so refreshes are
              queued instead of firing on page load.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.spend.byTenant.length === 0 ? (
                  <TableEmpty colSpan={3} message="No cost snapshots yet." />
                ) : (
                  data.spend.byTenant.map((row) => (
                    <TableRow key={row.tenantId}>
                      <TableCell>
                        <Link className="font-medium hover:underline" to={`/tenants/${row.tenantId}`}>
                          {row.customerName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <HealthIndicatorDot health={row.health} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(row.amountUsd, data.spend.currency)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent background jobs</CardTitle>
            <CardDescription>
              Queue driver: <code>{jobs.data?.driver ?? 'unknown'}</code>. Cross-account work is
              retryable and visible here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!jobs.data || jobs.data.items.length === 0 ? (
                  <TableEmpty colSpan={4} message="No jobs have run yet." />
                ) : (
                  jobs.data.items.slice(0, 8).map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-mono text-xs">{job.jobName}</TableCell>
                      <TableCell>{job.tenantName ?? '—'}</TableCell>
                      <TableCell
                        className={
                          job.status === 'SUCCEEDED'
                            ? 'text-success'
                            : job.status === 'FAILED'
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                        }
                      >
                        {titleCase(job.status)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatRelative(job.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Open alerts</CardTitle>
          <CardDescription>
            Derived from onboarding state and guardrail compliance — no external calls.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing needs attention.</p>
          ) : (
            data.alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{alert.title}</p>
                  <p className="text-sm text-muted-foreground">{alert.detail}</p>
                </div>
                {alert.tenantId ? (
                  <Link
                    className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                    to={`/tenants/${alert.tenantId}`}
                  >
                    Open
                  </Link>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

    </div>
  );
}
