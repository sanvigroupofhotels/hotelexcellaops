import { createFileRoute } from "@tanstack/react-router";
import { Reports } from "./reports";
import { PermissionGate } from "@/components/permission-gate";

export const Route = createFileRoute("/_authenticated/reporting/staff")({
  component: () => <PermissionGate permission="reporting.staff.view"><Reports /></PermissionGate>,
});
