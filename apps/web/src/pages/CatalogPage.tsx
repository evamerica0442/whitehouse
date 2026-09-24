import { useCatalog } from '@/auth/AuthProvider';
import { ErrorNotice, LoadingRows } from '@/components/EmptyState';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatRelative, titleCase } from '@/lib/format';

/**
 * Module 3 — pre-approved template catalog.
 *
 * Publishing, versioning and the approval workflow are real. Deploying into a
 * customer account is Milestone 2; the deploy endpoint records the request and marks
 * it FAILED with an explicit reason rather than pretending to have provisioned.
 */
export function CatalogPage() {
  const catalog = useCatalog();

  if (catalog.isLoading) return <LoadingRows label="Loading template catalog…" />;
  if (catalog.error) return <ErrorNotice message={(catalog.error as Error).message} />;

  const items = catalog.data?.items ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Template catalog</h1>
        <p className="text-sm text-muted-foreground">
          Standardised, pre-approved deployments offered to every tenant.
        </p>
      </header>

      <Alert variant="info">
        <AlertTitle>Milestone 1 scope</AlertTitle>
        <AlertDescription>
          Catalog management, versions and per-tenant entitlements are live. Automated deployment
          into a customer account is Milestone 2 — deployment requests are recorded with a clear
          reason instead of silently succeeding.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
          <CardDescription>{items.length} template(s) registered.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Current version</TableHead>
                <TableHead className="text-right">Versions</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableEmpty colSpan={6} message="No templates yet — run the seed to load the standards." />
              ) : (
                items.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell>
                      <p className="font-medium">{template.name}</p>
                      <p className="text-xs text-muted-foreground">{template.description}</p>
                      <code className="text-xs text-muted-foreground">{template.key}</code>
                    </TableCell>
                    <TableCell>{titleCase(template.kind)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          template.status === 'APPROVED'
                            ? 'success'
                            : template.status === 'PENDING_APPROVAL'
                              ? 'warning'
                              : 'muted'
                        }
                      >
                        {titleCase(template.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {template.currentVersion ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{template.versionCount}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelative(template.updatedAt)}
                    </TableCell>
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
