import { createFileRoute, Navigate } from "@tanstack/react-router";

/** Legacy quote reports — replaced by CRM Analytics + Owner Dashboard. */
export const Route = createFileRoute("/_authenticated/reports")({
  component: () => <Navigate to="/reporting/crm-analytics" replace />,
});
