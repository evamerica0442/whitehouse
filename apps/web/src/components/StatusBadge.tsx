import type { DeliveryStatus, HealthIndicator, TenantStatus } from '@whitehouse/shared';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import { deliveryStatusLabel, tenantStatusLabel } from '@/lib/format';

/**
 * Status presentation, centralised so a tenant's stage never appears in two
 * different colours on two different screens.
 */

const TENANT_STATUS_VARIANT: Record<TenantStatus, BadgeProps['variant']> = {
  NOT_STARTED: 'muted',
  TEMPLATE_SENT: 'warning',
  AWAITING_VERIFICATION: 'default',
  ACTIVE: 'success',
};

export function TenantStatusBadge({ status }: { status: TenantStatus }) {
  return <Badge variant={TENANT_STATUS_VARIANT[status]}>{tenantStatusLabel(status)}</Badge>;
}

const DELIVERY_STATUS_VARIANT: Record<DeliveryStatus, BadgeProps['variant']> = {
  NOT_SENT: 'muted',
  PENDING: 'warning',
  SENT: 'success',
  FAILED: 'destructive',
};

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return <Badge variant={DELIVERY_STATUS_VARIANT[status]}>{deliveryStatusLabel(status)}</Badge>;
}

const HEALTH_DOT: Record<HealthIndicator, string> = {
  GREEN: 'bg-success',
  YELLOW: 'bg-warning',
  RED: 'bg-destructive',
};

const HEALTH_TEXT: Record<HealthIndicator, string> = {
  GREEN: 'text-success',
  YELLOW: 'text-warning',
  RED: 'text-destructive',
};

/** Colour plus a text label — colour alone is not an accessible signal. */
export function HealthIndicatorDot({
  health,
  showLabel = true,
}: {
  health: HealthIndicator;
  showLabel?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className={`size-2.5 rounded-full ${HEALTH_DOT[health]}`} />
      {showLabel ? (
        <span className={`text-xs font-medium ${HEALTH_TEXT[health]}`}>
          {health === 'GREEN' ? 'Compliant' : health === 'YELLOW' ? 'Attention' : 'At risk'}
        </span>
      ) : (
        <span className="sr-only">{health}</span>
      )}
    </span>
  );
}
