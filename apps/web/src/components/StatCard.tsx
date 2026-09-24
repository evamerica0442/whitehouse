import { formatCurrency, formatRelative } from '@/lib/format';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Compact metric card used across the operational dashboard. */
export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'destructive'
          ? 'text-destructive'
          : 'text-foreground';

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function SpendCard({
  monthToDateUsd,
  previousMonthUsd,
  currency,
  lastRefreshedAt,
}: {
  monthToDateUsd: number;
  previousMonthUsd: number | null;
  currency: string;
  lastRefreshedAt: string | null;
}) {
  const delta =
    previousMonthUsd === null || previousMonthUsd === 0
      ? null
      : ((monthToDateUsd - previousMonthUsd) / previousMonthUsd) * 100;

  return (
    <StatCard
      label="Managed spend (MTD)"
      value={formatCurrency(monthToDateUsd, currency)}
      hint={
        lastRefreshedAt
          ? `Updated ${formatRelative(lastRefreshedAt)}${
              delta === null ? '' : ` · ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs last month`
            }`
          : 'No cost snapshot yet — run the cost refresh job'
      }
    />
  );
}
