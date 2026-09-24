import type {
  DeliveryStatus,
  HealthIndicator,
  TenantStatus,
} from '@whitehouse/shared';

/** Formatting helpers. Money and dates are the two things admins compare across rows. */

export function formatCurrency(amount: number | null, currency = 'USD'): string {
  if (amount === null || Number.isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: amount < 1000 ? 2 : 0,
  }).format(amount);
}

export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatRelative(value: string | null): string {
  if (!value) return 'never';
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diffMs / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

const TENANT_STATUS_LABELS: Record<TenantStatus, string> = {
  NOT_STARTED: 'Not started',
  TEMPLATE_SENT: 'Template sent',
  AWAITING_VERIFICATION: 'Awaiting verification',
  ACTIVE: 'Active',
};

export function tenantStatusLabel(status: TenantStatus): string {
  return TENANT_STATUS_LABELS[status];
}

const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  NOT_SENT: 'Not sent',
  PENDING: 'Sending',
  SENT: 'Sent',
  FAILED: 'Failed',
};

export function deliveryStatusLabel(status: DeliveryStatus): string {
  return DELIVERY_STATUS_LABELS[status];
}

export const HEALTH_LABELS: Record<HealthIndicator, string> = {
  GREEN: 'Compliant',
  YELLOW: 'Attention',
  RED: 'Action required',
};

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function truncate(value: string, max = 48): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
