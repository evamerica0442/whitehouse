import { useState } from 'react';
import type { OnboardingState } from '@whitehouse/shared';

import { useTenantMutations } from '@/auth/AuthProvider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';

/**
 * Step 2 — generate and inspect the customer's cross-account role template.
 *
 * The template is derived from tenant state rather than stored, so it can always be
 * regenerated and can never drift from the tenant record.
 */
export function TemplateStep({ tenantId, state }: { tenantId: string; state: OnboardingState }) {
  const { generateTemplate } = useTenantMutations(tenantId);
  const [copied, setCopied] = useState<'template' | 'instructions' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const template = state.template;

  const copy = async (kind: 'template' | 'instructions', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Clipboard access was blocked — select the text and copy manually.');
    }
  };

  const download = () => {
    if (!template) return;
    const blob = new Blob([template.templateBody], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${template.stackName}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>1 · Access template</CardTitle>
        <CardDescription>
          Creates <code>{template?.roleNames.join(' + ') ?? 'two scoped IAM roles'}</code> in the
          customer account, trusted only by this MSP account and gated on a unique ExternalId.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!template ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No template generated yet. Generating it records the ExternalId in the audit trail.
            </p>
            <Button
              onClick={async () => {
                setError(null);
                try {
                  await generateTemplate.mutateAsync({});
                } catch (caught) {
                  setError(
                    caught instanceof Error ? caught.message : 'Could not generate the template',
                  );
                }
              }}
              isLoading={generateTemplate.isPending}
            >
              Generate CloudFormation template
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Stack name</dt>
                <dd className="font-mono text-xs">{template.stackName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">External ID</dt>
                <dd className="font-mono text-xs">{template.externalId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Expected role ARN</dt>
                <dd className="font-mono text-xs">{template.roleArn}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Generated</dt>
                <dd>{formatDateTime(template.generatedAt)}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy('template', template.templateBody)}
              >
                {copied === 'template' ? 'Copied' : 'Copy template JSON'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy('instructions', template.instructions)}
              >
                {copied === 'instructions' ? 'Copied' : 'Copy instructions'}
              </Button>
              <Button variant="outline" size="sm" onClick={download}>
                Download .json
              </Button>
              {template.launchUrl ? (
                <a
                  className="text-sm underline"
                  href={template.launchUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open CloudFormation console
                </a>
              ) : null}
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Customer instructions</p>
              <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                {template.instructions}
              </pre>
            </div>

            <details>
              <summary className="cursor-pointer text-sm font-medium">Template body</summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
                {template.templateBody}
              </pre>
            </details>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
