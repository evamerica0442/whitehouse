import { useState } from 'react';

import { useAuditLog } from '@/auth/AuthProvider';
import { ErrorNotice, LoadingRows } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, titleCase } from '@/lib/format';

/**
 * Audit trail.
 *
 * Every cross-account action is attributed to the admin who triggered it. This is
 * the screen a customer's security reviewer will ask to see, so it reads straight
 * from the append-only `audit_logs` table with no client-side filtering that could
 * hide rows.
 */
export function AuditPage() {
  const [outcome, setOutcome] = useState('');
  const audit = useAuditLog({ ...(outcome ? { action: outcome } : {}), pageSize: 100 });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="text-sm text-muted-foreground">
            {audit.data ? `${audit.data.meta.total} recorded event(s)` : 'Loading events…'}
          </p>
        </div>

        <Select
          aria-label="Filter by action"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
        >
          <option value="">All actions</option>
          {[
            'USER_LOGIN',
            'USER_LOGIN_FAILED',
            'TENANT_CREATED',
            'ONBOARDING_TEMPLATE_GENERATED',
            'ONBOARDING_TEMPLATE_DELIVERED',
            'ONBOARDING_CONNECTION_VERIFIED',
            'ONBOARDING_COMPLETED',
            'GUARDRAILS_ASSIGNED',
            'TEMPLATE_DEPLOYED',
          ].map((action) => (
            <option key={action} value={action}>
              {titleCase(action)}
            </option>
          ))}
        </Select>
      </header>

      {audit.isLoading ? <LoadingRows label="Loading audit entries…" /> : null}
      {audit.error ? <ErrorNotice message={(audit.error as Error).message} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>Newest first. Append-only; entries are never edited.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Target</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!audit.data || audit.data.items.length === 0 ? (
                <TableEmpty colSpan={6} message="No audit entries yet." />
              ) : (
                audit.data.items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          entry.outcome === 'SUCCESS'
                            ? 'success'
                            : entry.outcome === 'DENIED'
                              ? 'warning'
                              : 'destructive'
                        }
                      >
                        {titleCase(entry.outcome)}
                      </Badge>
                    </TableCell>
                    <TableCell>{entry.actorEmail ?? 'system'}</TableCell>
                    <TableCell>{entry.tenantName ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{entry.targetType ?? '—'}</TableCell>
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
