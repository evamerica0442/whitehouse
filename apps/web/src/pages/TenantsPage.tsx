import { canPerform, ENVIRONMENT_TYPES, TENANT_STATUSES } from '@whitehouse/shared';
import { Search, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { useAuth, useTenants } from '@/auth/AuthProvider';
import { EmptyState, ErrorNotice, LoadingRows } from '@/components/EmptyState';
import { HealthIndicatorDot, TenantStatusBadge } from '@/components/StatusBadge';
import { buttonVariants } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatRelative, titleCase, truncate } from '@/lib/format';

/**
 * Tenant management list.
 *
 * Partially onboarded tenants are shown by default: a tenant stuck at "template
 * sent" is exactly the one an admin needs to chase, so it must not be hidden behind
 * an "active only" view.
 */
export function TenantsPage() {
  const { user } = useAuth();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [environment, setEnvironment] = useState('');
  const [sort, setSort] = useState<'createdAt' | 'customerName' | 'monthlySpendUsd'>('createdAt');

  const tenants = useTenants({
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(environment ? { environment } : {}),
    sort,
    direction: sort === 'customerName' ? 'asc' : 'desc',
    pageSize: 50,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tenants</h1>
          <p className="text-sm text-muted-foreground">
            {tenants.data ? `${tenants.data.meta.total} managed account(s)` : 'Loading accounts…'}
          </p>
        </div>

        {user && canPerform(user.role, 'onboarding:run') ? (
          <Link className={buttonVariants()} to="/onboarding/new">
            <UserPlus className="size-4" />
            Onboard a tenant
          </Link>
        ) : null}
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-72 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search customer, contact email, slug or account ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search tenants"
          />
        </div>

        <Select
          aria-label="Filter by onboarding status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All statuses</option>
          {TENANT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by environment"
          value={environment}
          onChange={(event) => setEnvironment(event.target.value)}
        >
          <option value="">All environments</option>
          {ENVIRONMENT_TYPES.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Sort tenants"
          value={sort}
          onChange={(event) =>
            setSort(event.target.value as 'createdAt' | 'customerName' | 'monthlySpendUsd')
          }
        >
          <option value="createdAt">Newest first</option>
          <option value="customerName">Name (A–Z)</option>
          <option value="monthlySpendUsd">Highest spend</option>
        </Select>
      </div>

      {tenants.isLoading ? <LoadingRows label="Loading tenants…" /> : null}
      {tenants.error ? <ErrorNotice message={(tenants.error as Error).message} /> : null}

      {tenants.data && tenants.data.items.length === 0 ? (
        <EmptyState
          title="No tenants match these filters"
          description="Adjust the search or filters, or onboard a new customer account."
        />
      ) : null}

      {tenants.data && tenants.data.items.length > 0 ? (
        <div className="rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Onboarding</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Region</TableHead>
                <TableHead className="text-right">Guardrails</TableHead>
                <TableHead className="text-right">MTD spend</TableHead>
                <TableHead>Last verified</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.data.items.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell>
                    <Link className="font-medium hover:underline" to={`/tenants/${tenant.id}`}>
                      {tenant.customerName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {tenant.awsAccountId
                        ? `Account ${tenant.awsAccountId}`
                        : truncate(tenant.contactEmail, 34)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <TenantStatusBadge status={tenant.status} />
                    {tenant.deliveryStatus === 'FAILED' ? (
                      <p className="mt-1 text-xs text-destructive">Email delivery failed</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <HealthIndicatorDot health={tenant.health} />
                  </TableCell>
                  <TableCell>{titleCase(tenant.environment)}</TableCell>
                  <TableCell className="font-mono text-xs">{tenant.region}</TableCell>
                  <TableCell className="text-right tabular-nums">{tenant.guardrailCount}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(tenant.monthlySpendUsd)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelative(tenant.lastVerifiedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {tenants.data && tenants.data.meta.total > tenants.data.items.length ? (
        <p className="text-xs text-muted-foreground">
          Showing {tenants.data.items.length} of {tenants.data.meta.total} — refine the search to
          narrow the list.
        </p>
      ) : null}

    </div>
  );
}
