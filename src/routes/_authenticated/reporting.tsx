import { createFileRoute, Outlet, Navigate, useRouterState } from "@tanstack/react-router";
import { usePermissions } from "@/hooks/use-permissions";

const REPORTING_ROUTES = [
  { to: "/reporting/analytics", permission: "reporting.analytics.view" },
  { to: "/reporting/payments", permission: "reporting.payments.view" },
  { to: "/reporting/staff", permission: "reporting.staff.view" },
] as const;

export const Route = createFileRoute("/_authenticated/reporting")({
  component: ReportingLayout,
});

/**
 * Reporting is a sidebar-driven group like Settings. Sub-pages
 * (Analytics, Payment Reports, Staff Reporting, and future reports such as
 * Occupancy, Revenue, OTA, Cancellation, GST, Cash Flow, Daily Closing)
 * are independent routes — no horizontal tab strip here on purpose.
 */
function ReportingLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { has, hasAny, isLoading } = usePermissions();
  const visibleRoutes = REPORTING_ROUTES.filter((r) => has(r.permission));

  if (isLoading) return <div className="p-20 flex justify-center text-sm text-muted-foreground">Loading access…</div>;
  if (!hasAny(REPORTING_ROUTES.map((r) => r.permission))) return <Navigate to="/" replace />;
  if (pathname === "/reporting" || pathname === "/reporting/") {
    return <Navigate to={visibleRoutes[0]?.to ?? "/"} replace />;
  }
  return <Outlet />;
}
