import { useState } from 'react';
import { useNavigate } from 'react-router';

import { useTenantMutations } from '@/auth/AuthProvider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { ENVIRONMENT_TYPES, SUPPORTED_REGIONS } from '@whitehouse/shared';
import { titleCase } from '@/lib/format';

/**
 * Step 1 of the onboarding wizard: capture the customer.
 *
 * Creating the tenant generates its per-tenant ExternalId immediately, because that
 * value has to be baked into the customer's CloudFormation trust policy before
 * anything else can happen.
 */
export function NewTenantForm() {
  const navigate = useNavigate();
  const { createTenant } = useTenantMutations(undefined);

  const [customerName, setCustomerName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [environment, setEnvironment] = useState('PRODUCTION');
  const [region, setRegion] = useState('us-east-1');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      const tenant = await createTenant.mutateAsync({
        customerName,
        ...(contactName ? { contactName } : {}),
        contactEmail,
        environment,
        region,
        ...(notes ? { notes } : {}),
      });
      navigate(`/onboarding/${tenant.id}`, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the tenant');
    }
  };

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Customer details</CardTitle>
        <CardDescription>
          Everything here is used to generate the customer&apos;s cross-account role template and to
          brand the onboarding email.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not create tenant</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Field label="Customer name" htmlFor="customerName">
          <Input
            id="customerName"
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            placeholder="Northwind Trading Co"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Primary contact" htmlFor="contactName">
            <Input
              id="contactName"
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
              placeholder="Ada Lovelace"
            />
          </Field>

          <Field label="Contact email" htmlFor="contactEmail" hint="Where the onboarding email goes.">
            <Input
              id="contactEmail"
              type="email"
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
              placeholder="cloud-team@customer.example"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Environment" htmlFor="environment">
            <Select
              id="environment"
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
            >
              {ENVIRONMENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Primary region"
            htmlFor="region"
            hint="Baked into the template and used for regional API calls."
          >
            <Select id="region" value={region} onChange={(event) => setRegion(event.target.value)}>
              {SUPPORTED_REGIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Internal notes" htmlFor="notes" hint="Visible to MSP staff only.">
          <Textarea
            id="notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Contract reference, escalation path, anything the next engineer should know."
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button
            onClick={submit}
            isLoading={createTenant.isPending}
            disabled={!customerName || !contactEmail}
          >
            Create tenant and generate template
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
