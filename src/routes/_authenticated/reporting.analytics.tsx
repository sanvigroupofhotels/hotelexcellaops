import { createFileRoute } from "@tanstack/react-router";
import { Analytics } from "./analytics";
import { PermissionGate } from "@/components/permission-gate";

export const Route = createFileRoute("/_authenticated/reporting/analytics")({
  component: () => <PermissionGate permission="reporting.analytics.view"><Analytics /></PermissionGate>,
});
