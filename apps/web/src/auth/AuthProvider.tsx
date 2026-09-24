import {
  type AssignGovernanceInput,
  type AuthSessionResponse,
  type CatalogTemplate,
  type ComplianceOverview,
  type DashboardSummary,
  type DeliveryChoiceInput,
  type GenerateTemplateInput,
  type GuardrailDefinition,
  type OnboardingState,
  type OnboardingTemplate,
  type SessionUser,
  type TenantGuardrailAssignment,
  type TenantListResponse,
  type TenantSummary,
  type TestConnectionResult,
} from '@whitehouse/shared';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, api, type QueryValue } from '@/lib/api-client';

/**
 * Auth context.
 *
 * The session is just another cached resource: every screen that needs the current
 * user shares one fetch, and a 401 anywhere degrades to "signed out" rather than an
 * error page.
 */

interface AuthContextValue {
  user: SessionUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  requestMagicLink: (email: string) => Promise<void>;
  consumeMagicLink: (token: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const sessionQueryKey = ['session'] as const;

async function fetchSession(): Promise<SessionUser | null> {
  try {
    const response = await api.get<AuthSessionResponse>('/auth/me');
    return response.user;
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthorized) return null;
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: sessionQueryKey,
    queryFn: fetchSession,
    retry: false,
    staleTime: 60_000,
  });

  const loginMutation = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      api.post<AuthSessionResponse>('/auth/login', credentials),
  });

  const magicLinkMutation = useMutation({
    mutationFn: (email: string) => api.post<{ status: string }>('/auth/magic-link', { email }),
  });

  const consumeMutation = useMutation({
    mutationFn: (token: string) =>
      api.post<AuthSessionResponse>('/auth/magic-link/consume', { token }),
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post<{ status: string }>('/auth/logout'),
  });

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await loginMutation.mutateAsync({ email, password });
      queryClient.setQueryData(sessionQueryKey, response.user);
    },
    [loginMutation, queryClient],
  );

  const requestMagicLink = useCallback(
    async (email: string) => {
      await magicLinkMutation.mutateAsync(email);
    },
    [magicLinkMutation],
  );

  const consumeMagicLink = useCallback(
    async (token: string) => {
      const response = await consumeMutation.mutateAsync(token);
      queryClient.setQueryData(sessionQueryKey, response.user);
    },
    [consumeMutation, queryClient],
  );

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
    // Drop every cached tenant/cost payload so the next user never sees stale data.
    queryClient.clear();
  }, [logoutMutation, queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session.data ?? null,
      isLoading: session.isLoading,
      login,
      requestMagicLink,
      consumeMagicLink,
      logout,
    }),
    [session.data, session.isLoading, login, requestMagicLink, consumeMagicLink, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}

// ---------------------------------------------------------------------------
// Data hooks — the only place that knows endpoint paths and cache keys.
// ---------------------------------------------------------------------------

export const queryKeys = {
  tenants: (query: Record<string, QueryValue> = {}) => ['tenants', query] as const,
  tenant: (tenantId: string) => ['tenant', tenantId] as const,
  onboarding: (tenantId: string) => ['onboarding', tenantId] as const,
  dashboard: ['dashboard'] as const,
  guardrails: ['guardrails'] as const,
  compliance: ['compliance'] as const,
  tenantGuardrails: (tenantId: string) => ['tenant-guardrails', tenantId] as const,
  catalog: ['catalog'] as const,
  audit: (query: Record<string, QueryValue> = {}) => ['audit', query] as const,
  jobs: ['jobs'] as const,
};

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => api.get<DashboardSummary>('/dashboard/summary'),
  });
}

export function useTenants(query: Record<string, QueryValue> = {}) {
  return useQuery({
    queryKey: queryKeys.tenants(query),
    queryFn: () => api.get<TenantListResponse>('/tenants', query),
  });
}

export function useTenant(tenantId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.tenant(tenantId ?? ''),
    queryFn: () => api.get<TenantSummary>(`/tenants/${tenantId}`),
    enabled: Boolean(tenantId),
  });
}

export function useOnboardingState(tenantId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.onboarding(tenantId ?? ''),
    queryFn: () => api.get<OnboardingState>(`/tenants/${tenantId}/onboarding`),
    enabled: Boolean(tenantId),
  });
}

export function useGuardrails() {
  return useQuery({
    queryKey: queryKeys.guardrails,
    queryFn: () => api.get<{ items: GuardrailDefinition[] }>('/guardrails'),
  });
}

export function useCompliance() {
  return useQuery({
    queryKey: queryKeys.compliance,
    queryFn: () => api.get<ComplianceOverview>('/guardrails/compliance'),
  });
}

export function useTenantGuardrails(tenantId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.tenantGuardrails(tenantId ?? ''),
    queryFn: () =>
      api.get<{ items: TenantGuardrailAssignment[] }>(`/tenants/${tenantId}/guardrails`),
    enabled: Boolean(tenantId),
  });
}

export function useCatalog() {
  return useQuery({
    queryKey: queryKeys.catalog,
    queryFn: () => api.get<{ items: CatalogTemplate[] }>('/catalog/templates'),
  });
}

export function useScpPolicies() {
  return useQuery({
    queryKey: ['scp-policies'] as const,
    queryFn: () =>
      api.get<{ items: { id: string; name: string; description: string }[] }>('/scp-policies'),
  });
}

export interface JobRunRow {
  id: string;
  jobName: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  tenantName: string | null;
  error: string | null;
  createdAt: string;
}

export function useJobs() {
  return useQuery({
    queryKey: queryKeys.jobs,
    queryFn: () => api.get<{ driver: string; items: JobRunRow[] }>('/jobs'),
  });
}

export function useAuditLog(query: Record<string, QueryValue> = {}) {
  return useQuery({
    queryKey: queryKeys.audit(query),
    queryFn: () =>
      api.get<{
        items: {
          id: string;
          action: string;
          outcome: string;
          actorEmail: string | null;
          tenantName: string | null;
          targetType: string | null;
          createdAt: string;
        }[];
        meta: { total: number };
      }>('/audit', query),
  });
}

/**
 * Onboarding mutations. Each invalidates the tenant list, the tenant, its
 * onboarding state, the dashboard and the job list — the wizard's whole point is
 * that the pipeline view changes as you progress.
 */
export function useTenantMutations(tenantId: string | undefined) {
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    for (const key of [
      ['tenants'],
      ['tenant', tenantId ?? ''],
      ['onboarding', tenantId ?? ''],
      ['dashboard'],
      ['jobs'],
    ]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }, [queryClient, tenantId]);

  const createTenant = useMutation({
    mutationFn: (input: unknown) => api.post<TenantSummary>('/tenants', input),
    onSuccess: invalidate,
  });

  const generateTemplate = useMutation({
    mutationFn: (input: GenerateTemplateInput = {}) =>
      api.post<OnboardingTemplate>(`/tenants/${tenantId}/onboarding/template`, input),
    onSuccess: invalidate,
  });

  const deliverTemplate = useMutation({
    mutationFn: (input: DeliveryChoiceInput) =>
      api.post<{
        status: string;
        recipient: string | null;
        error: string | null;
        providerMessageId: string | null;
      }>(`/tenants/${tenantId}/onboarding/delivery`, input),
    onSuccess: invalidate,
  });

  const verifyConnection = useMutation({
    mutationFn: (input: { awsAccountId: string; roleArn?: string }) =>
      api.post<TestConnectionResult>(`/tenants/${tenantId}/onboarding/verify`, input),
    onSuccess: invalidate,
  });

  const assignGovernance = useMutation({
    mutationFn: (input: AssignGovernanceInput) =>
      api.post<{ status: string; missingGuardrailKeys: string[]; missingTemplateKeys: string[] }>(
        `/tenants/${tenantId}/onboarding/governance`,
        input,
      ),
    onSuccess: invalidate,
  });

  const refreshCost = useMutation({
    mutationFn: () =>
      api.post<{ status: string; jobId: string }>(`/tenants/${tenantId}/cost/refresh`),
    onSuccess: invalidate,
  });

  return {
    createTenant,
    generateTemplate,
    deliverTemplate,
    verifyConnection,
    assignGovernance,
    refreshCost,
  };
}

/** Batch job trigger used by the dashboard, mirroring the scheduled run. */
export function useRunDailyJobs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<{ costJobId: string; guardrailJobId: string }>('/jobs/run-daily'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}


