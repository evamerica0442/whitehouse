import {
  canPerform,
  ROLE_LABELS,
  type Permission,
} from '@whitehouse/shared';
import {
  Boxes,
  LayoutDashboard,
  ListTree,
  ScrollText,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router';

import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission: Permission;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'tenant:read' },
  { to: '/tenants', label: 'Tenants', icon: ListTree, permission: 'tenant:read' },
  { to: '/onboarding/new', label: 'Onboard tenant', icon: UserPlus, permission: 'onboarding:run' },
  { to: '/guardrails', label: 'Guardrails', icon: ShieldCheck, permission: 'guardrail:read' },
  { to: '/catalog', label: 'Template catalog', icon: Boxes, permission: 'template:read' },
  { to: '/audit', label: 'Audit log', icon: ScrollText, permission: 'audit:read' },
];

/**
 * Application shell: sidebar navigation filtered by the signed-in role, plus the
 * account footer. Nav items are hidden rather than disabled — a control the user
 * can never use is noise.
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const visibleItems = NAV_ITEMS.filter((item) => (user ? canPerform(user.role, item.permission) : false));

  return (
    <div className="grid min-h-screen grid-cols-[260px_1fr] bg-background">
      <aside className="flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="px-5 py-5">
          <p className="text-sm font-semibold tracking-tight">Whitehouse Cloudguard</p>
          <p className="text-xs text-muted-foreground">MSP console</p>
        </div>

        <nav className="flex-1 space-y-1 px-2" aria-label="Main">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                )
              }
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-4">
          {user ? (
            <>
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              <p className="mt-1 text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={async () => {
                  await logout();
                  navigate('/login', { replace: true });
                }}
              >
                Sign out
              </Button>
            </>
          ) : null}
        </div>
      </aside>

      <main className="min-w-0">
        <div className="mx-auto max-w-[1400px] p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
