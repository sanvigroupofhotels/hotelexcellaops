import { createFileRoute } from "@tanstack/react-router";
import { Analytics } from "./analytics";
import { PermissionGate } from "@/components/permission-gate";

/**
 * CRM Analytics — quote / lead funnel and conversion intelligence.
 * Moved from `/reporting/analytics`. Operational property KPIs now live on
 * the Owner Dashboard at `/reporting/owner-dashboard`.
 */
export const Route = createFileRoute("/_authenticated/reporting/crm-analytics")({
  component: () => (
    <PermissionGate permission="reporting.analytics.view">
      <Analytics />
    </PermissionGate>
  ),
});
