import { useState } from 'react';
import type { OnboardingState } from '@whitehouse/shared';

import { useCatalog, useGuardrails, useScpPolicies, useTenantMutations } from '@/auth/AuthProvider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { titleCase } from '@/lib/format';

/**
 * Step 5 — governance baseline and catalog entitlements.
 *
 * Activation is only possible once the connection test has passed (the API enforces
 * this independently). Unknown keys are reported back rather than silently dropped,
 * so a stale selection can never look like a successful assignment.
 */
export function GovernanceStep({ tenantId, state }: { tenantId: string; state: OnboardingState }) {
  const guardrails = useGuardrails();
  const catalog = useCatalog();
  const scpPolicies = useScpPolicies();
  const { assignGovernance } = useTenantMutations(tenantId);

  const [selectedGuardrails, setSelectedGuardrails] = useState<string[]>([]);
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [selectedScps, setSelectedScps] = useState<string[]>([]);
  const [activate, setActivate] = useState(true);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!state.tenant.lastVerifiedAt && !state.lastConnectionTest?.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>4 · Guardrails &amp; catalog</CardTitle>
          <CardDescription>Blocked until the connection test passes.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="warning">
            <AlertTitle>Verify access first</AlertTitle>
            <AlertDescription>
              Activating a tenant with an untested role is exactly what this pipeline exists to
              prevent. Finish the Test Connection step first.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const toggle = (value: string, list: string[], setList: (next: string[]) => void): void => {
    setList(list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);
  };

  const submit = async () => {
    setError(null);
    setOutcome(null);
    try {
      const response = await assignGovernance.mutateAsync({
        guardrailKeys: selectedGuardrails,
        templateKeys: selectedTemplates,
        scpPolicyIds: selectedScps,
        activateTenant: activate,
      });

      const warnings = [
        response.missingGuardrailKeys.length > 0
          ? `unknown guardrails: ${response.missingGuardrailKeys.join(', ')}`
          : null,
        response.missingTemplateKeys.length > 0
          ? `unknown or unapproved templates: ${response.missingTemplateKeys.join(', ')}`
          : null,
      ].filter(Boolean);

      setOutcome(
        `Saved. Tenant status is now ${titleCase(response.status)}.${
          warnings.length > 0 ? ` Ignored — ${warnings.join('; ')}.` : ''
        }`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not assign governance');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>4 · Guardrails &amp; catalog</CardTitle>
        <CardDescription>
          Apply the baseline controls, SCPs, and the pre-approved templates this tenant may deploy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ChecklistSection
          title="Guardrails"
          hint="Assignments start as UNKNOWN until drift detection evaluates them (Milestone 2)."
          items={(guardrails.data?.items ?? []).map((item) => ({
            value: item.key,
            label: `${item.name} (${titleCase(item.severity)})`,
          }))}
          selected={selectedGuardrails}
          onToggle={(value) => toggle(value, selectedGuardrails, setSelectedGuardrails)}
        />

        <ChecklistSection
          title="Service control policies"
          hint="Attached at the account level in the MSP organization."
          items={(scpPolicies.data?.items ?? []).map((item) => ({
            value: item.id,
            label: item.name,
          }))}
          selected={selectedScps}
          onToggle={(value) => toggle(value, selectedScps, setSelectedScps)}
        />

        <ChecklistSection
          title="Template catalog access"
          hint="Only APPROVED templates can be granted."
          items={(catalog.data?.items ?? [])
            .filter((item) => item.status === 'APPROVED')
            .map((item) => ({ value: item.key, label: item.name }))}
          selected={selectedTemplates}
          onToggle={(value) => toggle(value, selectedTemplates, setSelectedTemplates)}
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activate}
            onChange={(event) => setActivate(event.target.checked)}
          />
          Mark tenant <strong>Active</strong> and add it to the operations dashboard
        </label>

        {outcome ? (
          <Alert variant="success">
            <AlertTitle>Governance saved</AlertTitle>
            <AlertDescription>{outcome}</AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not save</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Button onClick={submit} isLoading={assignGovernance.isPending}>
          Save governance and finish onboarding
        </Button>
      </CardContent>
    </Card>
  );
}

function ChecklistSection({
  title,
  hint,
  items,
  selected,
  onToggle,
}: {
  title: string;
  hint: string;
  items: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{title}</legend>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing available to assign.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <label
              key={item.value}
              className="flex items-start gap-2 rounded-md border border-border p-2 text-sm"
            >
              <input
                type="checkbox"
                checked={selected.includes(item.value)}
                onChange={() => onToggle(item.value)}
                className="mt-0.5"
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

