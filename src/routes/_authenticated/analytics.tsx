import { createFileRoute, Navigate } from "@tanstack/react-router";

/** Legacy /analytics URL — redirect to CRM Analytics. */
export const Route = createFileRoute("/_authenticated/analytics")({
  component: () => <Navigate to="/reporting/crm-analytics" replace />,
});
