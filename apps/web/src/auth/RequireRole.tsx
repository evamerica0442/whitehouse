import { canPerform, PERMISSION_LABELS, type Permission } from '@whitehouse/shared';
import { ShieldAlert } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import { useAuth } from './AuthProvider';

/**
 * Route-level role gate.
 *
 * This mirrors the API's permission checks rather than replacing them — the server
 * remains the enforcement point, and this exists so an admin never fills in a form
 * that was always going to be rejected.
 */
export function RequireRole({ permission }: { permission: Permission }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <FullPageLoader label="Checking your session…" />;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (!canPerform(user.role, permission)) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Alert variant="warning">
          <ShieldAlert className="mb-1" />
          <AlertTitle>Insufficient permissions</AlertTitle>
          <AlertDescription>
            Your role does not include <strong>{PERMISSION_LABELS[permission]}</strong>. Ask a super
            admin if you need it.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <Outlet />;
}

export function FullPageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center gap-3 text-sm text-muted-foreground">
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      {label}
    </div>
  );
}
