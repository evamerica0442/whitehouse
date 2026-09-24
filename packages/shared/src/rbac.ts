import type { AdminRole } from './enums';

/**
 * Role tiers from the project brief, expressed as capabilities.
 *
 * This lives in `shared` rather than in the API because the console must gate the
 * same actions the API enforces: two copies of this mapping would eventually
 * disagree, and the failure mode of a mismatch (a button that always 403s, or worse
 * a hidden-but-callable write) is exactly what a governance tool must not have.
 */

export const ROLE_RANK: Record<AdminRole, number> = {
  READ_ONLY: 0,
  ENGINEER: 1,
  SUPER_ADMIN: 2,
};

export const PERMISSIONS = [
  'tenant:read',
  'tenant:write',
  'onboarding:run',
  'cost:read',
  'cost:refresh',
  'guardrail:read',
  'guardrail:write',
  'template:read',
  'template:write',
  'template:approve',
  'template:deploy',
  'audit:read',
  'user:manage',
  'job:run',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Least privilege: read-only staff get dashboards and reports, engineers can
 * onboard tenants / apply guardrails / deploy templates, and only super admins can
 * approve templates or manage admin users.
 */
const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  READ_ONLY: ['tenant:read', 'cost:read', 'guardrail:read', 'template:read', 'audit:read'],
  ENGINEER: [
    'tenant:read',
    'tenant:write',
    'onboarding:run',
    'cost:read',
    'cost:refresh',
    'guardrail:read',
    'guardrail:write',
    'template:read',
    'template:write',
    'template:deploy',
    'audit:read',
    'job:run',
  ],
  SUPER_ADMIN: [
    'tenant:read',
    'tenant:write',
    'onboarding:run',
    'cost:read',
    'cost:refresh',
    'guardrail:read',
    'guardrail:write',
    'template:read',
    'template:write',
    'template:approve',
    'template:deploy',
    'audit:read',
    'user:manage',
    'job:run',
  ],
};

export function canPerform(role: AdminRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasAtLeastRole(role: AdminRole, minimum: AdminRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function permissionsForRole(role: AdminRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: 'Super admin',
  ENGINEER: 'Engineer',
  READ_ONLY: 'Read-only',
};

/** Human-readable labels so the UI never renders a raw enum value. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'tenant:read': 'View tenants',
  'tenant:write': 'Create and edit tenants',
  'onboarding:run': 'Run tenant onboarding',
  'cost:read': 'View cost data',
  'cost:refresh': 'Refresh cost data',
  'guardrail:read': 'View guardrails',
  'guardrail:write': 'Assign guardrails',
  'template:read': 'View template catalog',
  'template:write': 'Publish template versions',
  'template:approve': 'Approve templates',
  'template:deploy': 'Deploy templates',
  'audit:read': 'View audit log',
  'user:manage': 'Manage admin users',
  'job:run': 'Trigger background jobs',
};
