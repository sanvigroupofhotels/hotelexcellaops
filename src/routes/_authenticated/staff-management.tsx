import { createFileRoute, Link, Outlet, Navigate, useRouterState } from "@tanstack/react-router";
import { UserCog, ClipboardCheck, IndianRupee } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/use-permissions";

export const Route = createFileRoute("/_authenticated/staff-management")({
  component: StaffManagementLayout,
});

const TABS = [
  { to: "/staff-management/master", label: "Staff Master", icon: UserCog, permission: "staff.master" },
  { to: "/staff-management/attendance", label: "Attendance", icon: ClipboardCheck, permission: "staff.attendance" },
  { to: "/staff-management/salary", label: "Salary", icon: IndianRupee, permission: "staff.salary" },
] as const;

function StaffManagementLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { has, hasAny, isLoading } = usePermissions();
  const visibleTabs = TABS.filter((t) => has(t.permission));

  if (isLoading) return <div className="p-20 flex justify-center text-sm text-muted-foreground">Loading access…</div>;
  if (!hasAny(TABS.map((t) => t.permission))) return <Navigate to="/" replace />;
  if (pathname === "/staff-management" || pathname === "/staff-management/") {
    return <Navigate to={visibleTabs[0]?.to ?? "/"} replace />;
  }
  return (
    <div className="min-h-screen">
      <div className="border-b border-border bg-card/40 sticky top-0 z-20 backdrop-blur">
        <div className="px-4 md:px-6 py-3 flex items-center gap-2 overflow-x-auto max-w-[1400px]">
          <div className="font-display text-sm text-muted-foreground tracking-wider uppercase mr-3 shrink-0">Staff Management</div>
          {visibleTabs.map((t) => {
            const active = pathname.startsWith(t.to);
            const Icon = t.icon;
            return (
              <Link key={t.to} to={t.to}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap border",
                  active ? "bg-gold-soft border-gold/40 text-gold" : "border-border text-muted-foreground hover:text-foreground",
                )}>
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </Link>
            );
          })}
        </div>
      </div>
      <Outlet />
    </div>
  );
}
