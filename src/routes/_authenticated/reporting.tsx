import { createFileRoute, Outlet, Navigate, useRouterState } from "@tanstack/react-router";

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
  if (pathname === "/reporting" || pathname === "/reporting/") {
    return <Navigate to="/reporting/analytics" replace />;
  }
  return <Outlet />;
}
