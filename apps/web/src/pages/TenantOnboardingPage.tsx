import { ONBOARDING_STEPS, type OnboardingStep } from '@whitehouse/shared';
import { Link, useParams } from 'react-router';

import { useOnboardingState } from '@/auth/AuthProvider';
import { ErrorNotice, LoadingRows } from '@/components/EmptyState';
import { TenantStatusBadge } from '@/components/StatusBadge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { NewTenantForm } from './onboarding/NewTenantForm';
import { DeliveryStep } from './onboarding/DeliveryStep';
import { GovernanceStep } from './onboarding/GovernanceStep';
import { TemplateStep } from './onboarding/TemplateStep';
import { VerificationStep } from './onboarding/VerificationStep';

const STEP_LABELS: Record<OnboardingStep, string> = {
  DETAILS: 'Customer details',
  TEMPLATE: 'Access template',
  DELIVERY: 'Delivery',
  VERIFICATION: 'Test connection',
  GOVERNANCE: 'Guardrails & catalog',
  COMPLETE: 'Active',
};

/**
 * The onboarding wizard.
 *
 * `/onboarding/new` starts at step 1; `/onboarding/:tenantId` resumes wherever the
 * tenant actually is, so a half-finished onboarding can always be picked up — which
 * is the whole reason tenant status is tracked in four states rather than two.
 */
export function TenantOnboardingPage() {
  const { tenantId } = useParams<{ tenantId: string }>();

  if (!tenantId) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Onboard a tenant</h1>
          <p className="text-sm text-muted-foreground">
            Step 1 of {ONBOARDING_STEPS.length - 1} — capture the customer, then hand them a scoped
            cross-account role template.
          </p>
        </header>
        <NewTenantForm />
      </div>
    );
  }

  return <OnboardingWizard tenantId={tenantId} />;
}

function OnboardingWizard({ tenantId }: { tenantId: string }) {
  const state = useOnboardingState(tenantId);

  if (state.isLoading) return <LoadingRows label="Loading onboarding state…" />;
  if (state.error) return <ErrorNotice message={(state.error as Error).message} />;
  if (!state.data) return null;

  const data = state.data;
  const currentIndex = ONBOARDING_STEPS.indexOf(data.currentStep);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.tenant.customerName}</h1>
          <p className="text-sm text-muted-foreground">
            Onboarding step {Math.min(currentIndex + 1, ONBOARDING_STEPS.length - 1)} of{' '}
            {ONBOARDING_STEPS.length - 1}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <TenantStatusBadge status={data.tenant.status} />
          <Link className={buttonVariants({ variant: 'outline' })} to={`/tenants/${tenantId}`}>
            Tenant detail
          </Link>
        </div>
      </header>

      <ol className="flex flex-wrap gap-2" aria-label="Onboarding progress">
        {ONBOARDING_STEPS.map((step, index) => {
          const isCompleted = data.completedSteps.includes(step);
          const isCurrent = step === data.currentStep;

          return (
            <li
              key={step}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
                isCurrent
                  ? 'border-primary bg-primary/10 font-medium text-foreground'
                  : isCompleted
                    ? 'border-success/40 bg-success/10 text-foreground'
                    : 'border-border text-muted-foreground',
              )}
            >
              <span className="tabular-nums">{index + 1}</span>
              {STEP_LABELS[step]}
            </li>
          );
        })}
      </ol>

      {data.currentStep === 'COMPLETE' ? (
        <Card>
          <CardHeader>
            <CardTitle>Onboarding complete</CardTitle>
            <CardDescription>
              Access is verified and the governance baseline is assigned. This account now appears in
              the operations dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Link className={buttonVariants()} to={`/tenants/${tenantId}`}>
              Open tenant
            </Link>
            <Link className={buttonVariants({ variant: 'outline' })} to="/tenants">
              Back to tenants
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <TemplateStep tenantId={tenantId} state={data} />
      <DeliveryStep tenantId={tenantId} state={data} />
      <VerificationStep tenantId={tenantId} state={data} />
      <GovernanceStep tenantId={tenantId} state={data} />
    </div>
  );
}
