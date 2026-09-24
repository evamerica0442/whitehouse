import { useState } from 'react';
import type { OnboardingState } from '@whitehouse/shared';

import { useTenantMutations } from '@/auth/AuthProvider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';

/**
 * Step 3 — deliver the template.
 *
 * Both options are always offered: manual (copy/paste and send it however you like)
 * and automated (email the customer contact through Resend). A failed email never
 * blocks progress, because the manual path is still right there.
 */
export function DeliveryStep({ tenantId, state }: { tenantId: string; state: OnboardingState }) {
  const { deliverTemplate } = useTenantMutations(tenantId);
  const [method, setMethod] = useState<'MANUAL' | 'AUTOMATED'>('MANUAL');
  const [recipient, setRecipient] = useState(state.tenant.contactEmail);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!state.template) return null;

  const send = async () => {
    setError(null);
    setResult(null);
    try {
      const response = await deliverTemplate.mutateAsync({ method, recipientEmail: recipient });
      setResult(
        response.status === 'SENT'
          ? method === 'AUTOMATED'
            ? `Email sent to ${response.recipient ?? recipient}.`
            : 'Recorded as handed over — copy the template above and send it your usual way.'
          : `Delivery status: ${response.status}. ${response.error ?? ''}`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not record the delivery');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>2 · Deliver the template</CardTitle>
        <CardDescription>
          Chosen per onboarding — not a global setting. Both options stay available every time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <MethodOption
            active={method === 'MANUAL'}
            title="Manual"
            description="Show the template and instructions so you can send them yourself."
            onSelect={() => setMethod('MANUAL')}
          />
          <MethodOption
            active={method === 'AUTOMATED'}
            title="Automated email"
            description="Email the template (attached) and instructions to the customer contact."
            onSelect={() => setMethod('AUTOMATED')}
          />
        </div>

        {method === 'AUTOMATED' ? (
          <Field
            label="Recipient"
            htmlFor="recipient"
            hint="Defaults to the tenant's contact email."
          >
            <Input
              id="recipient"
              type="email"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </Field>
        ) : null}

        {result ? (
          <Alert variant="success">
            <AlertTitle>Delivery recorded</AlertTitle>
            <AlertDescription>{result}</AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Delivery failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Button onClick={send} isLoading={deliverTemplate.isPending}>
          {method === 'AUTOMATED' ? 'Send onboarding email' : 'Mark as handed over'}
        </Button>
      </CardContent>
    </Card>
  );
}

function MethodOption({
  active,
  title,
  description,
  onSelect,
}: {
  active: boolean;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`rounded-lg border p-4 text-left transition-colors ${
        active ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/40'
      }`}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </button>
  );
}
