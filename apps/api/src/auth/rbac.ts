/**
 * Role/permission model.
 *
 * The mapping itself lives in `@whitehouse/shared` so the API guards and the web
 * UI cannot disagree about what a role may do. This module exists only to keep the
 * server-side import path stable.
 */
export {
  PERMISSIONS,
  PERMISSION_LABELS,
  ROLE_LABELS,
  ROLE_RANK,
  canPerform,
  hasAtLeastRole,
  permissionsForRole,
  type Permission,
} from '@whitehouse/shared';

