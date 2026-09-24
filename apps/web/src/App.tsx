import { Navigate, Route, Routes } from 'react-router';

import { RequireRole } from './auth/RequireRole';
import { AppShell } from './components/layout/AppShell';
import { AuditPage } from './pages/AuditPage';
import { CatalogPage } from './pages/CatalogPage';
import { DashboardPage } from './pages/DashboardPage';
import { GuardrailsPage } from './pages/GuardrailsPage';
import { LoginPage } from './pages/LoginPage';
import { MagicLinkPage } from './pages/MagicLinkPage';
import { TenantDetailPage } from './pages/TenantDetailPage';
import { TenantOnboardingPage } from './pages/TenantOnboardingPage';
import { TenantsPage } from './pages/TenantsPage';

/**
 * Route map for the console.
 *
 * Everything except the two auth screens sits behind RequireRole, and the
 * write-capable modules are gated at ENGINEER so a read-only account cannot even
 * reach the onboarding wizard UI (the API enforces the same rule independently).
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/magic-link" element={<MagicLinkPage />} />

      <Route element={<RequireRole permission="tenant:read" />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tenants" element={<TenantsPage />} />
          <Route path="/tenants/:tenantId" element={<TenantDetailPage />} />
          <Route path="/guardrails" element={<GuardrailsPage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/audit" element={<AuditPage />} />
        </Route>
      </Route>

      <Route element={<RequireRole permission="onboarding:run" />}>
        <Route element={<AppShell />}>
          <Route path="/onboarding/new" element={<TenantOnboardingPage />} />
          <Route path="/onboarding/:tenantId" element={<TenantOnboardingPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
