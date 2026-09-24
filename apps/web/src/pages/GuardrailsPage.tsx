import { useCompliance, useGuardrails } from '@/auth/AuthProvider';
import { StatCard } from '@/components/StatCard';
import { ErrorNotice, LoadingRows } from '@/components/EmptyState';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { titleCase } from '@/lib/format';

/**
 * Module 2 — guardrail library and compliance overview.
 *
 * Milestone 1 ships the catalog, the per-tenant assignments and this read model.
 * Enforcement (applying SCPs/Config rules inside customer accounts) and scheduled
 * drift evaluation are Milestone 2, which is why assignments report UNKNOWN rather
 * than a fabricated COMPLIANT.
 */
export function GuardrailsPage() {
  const guardrails = useGuardrails();
  const compliance = useCompliance();

  if (guardrails.isLoading) return <LoadingRows label="Loading guardrail library…" />;
  if (guardrails.error) return <ErrorNotice message={(guardrails.error as Error).message} />;

  const items = guardrails.data?.items ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Guardrails</h1>
        <p className="text-sm text-muted-foreground">
          Pre-built compliance baselines applied per tenant during onboarding.
        </p>
      </header>

      <Alert variant="info">
        <AlertTitle>Milestone 1 scope</AlertTitle>
        <AlertDescription>
          The library, tenant assignments and this compliance view are live. Enforcement inside
          customer accounts and scheduled drift evaluation land in Milestone 2 — until then,
          assignments stay UNKNOWN rather than reporting a state we have not measured.
        </AlertDescription>
      </Alert>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Avg. compliance"
          value={`${compliance.data?.totals.compliancePercent ?? 0}%`}
          hint="Across every assigned control"
        />
        <StatCard label="Green tenants" value={String(compliance.data?.totals.green ?? 0)} tone="success" />
        <StatCard label="Attention" value={String(compliance.data?.totals.yellow ?? 0)} tone="warning" />
        <StatCard
          label="At risk"
          value={String(compliance.data?.totals.red ?? 0)}
          tone={(compliance.data?.totals.red ?? 0) > 0 ? 'destructive' : 'default'}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Control library</CardTitle>
          <CardDescription>{items.length} active control(s) available for assignment.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Control</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Enforcement</TableHead>
                <TableHead>Control Tower ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableEmpty colSpan={5} message="No guardrails in the library yet — run the seed." />
              ) : (
                items.map((guardrail) => (
                  <TableRow key={guardrail.key}>
                    <TableCell>
                      <p className="font-medium">{guardrail.name}</p>
                      <p className="text-xs text-muted-foreground">{guardrail.description}</p>
                      <code className="text-xs text-muted-foreground">{guardrail.key}</code>
                    </TableCell>
                    <TableCell>{titleCase(guardrail.category)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          guardrail.severity === 'CRITICAL' || guardrail.severity === 'HIGH'
                            ? 'destructive'
                            : guardrail.severity === 'MEDIUM'
                              ? 'warning'
                              : 'muted'
                        }
                      >
                        {titleCase(guardrail.severity)}
                      </Badge>
                    </TableCell>
                    <TableCell>{titleCase(guardrail.enforcement)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {guardrail.controlTowerControlId ?? '—'}
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
          <CardTitle>Compliance by tenant</CardTitle>
          <CardDescription>
            Counts of assigned controls per tenant. Unknown means "not evaluated yet", which is not
            the same as compliant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead className="text-right">Evaluated</TableHead>
                <TableHead className="text-right">Compliant</TableHead>
                <TableHead className="text-right">Non-compliant</TableHead>
                <TableHead className="text-right">Unknown</TableHead>
                <TableHead className="text-right">Compliance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!compliance.data || compliance.data.perTenant.length === 0 ? (
                <TableEmpty colSpan={6} message="No tenants to evaluate yet." />
              ) : (
                compliance.data.perTenant.map((row) => (
                  <TableRow key={row.tenantId}>
                    <TableCell className="font-mono text-xs">{row.tenantId.slice(0, 8)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.evaluated}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.compliant}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.nonCompliant}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.unknown}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.compliancePercent}%</TableCell>
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
