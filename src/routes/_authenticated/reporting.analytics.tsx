import { createFileRoute, Navigate } from "@tanstack/react-router";

/**
 * Legacy route — redirects to the renamed CRM Analytics page so existing
 * bookmarks keep working.
 */
export const Route = createFileRoute("/_authenticated/reporting/analytics")({
  component: () => <Navigate to="/reporting/crm-analytics" replace />,
});
