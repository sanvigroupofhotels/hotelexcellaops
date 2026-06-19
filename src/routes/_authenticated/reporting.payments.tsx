import { createFileRoute } from "@tanstack/react-router";
import { PaymentsReportsPage } from "./payments-reports";
import { PermissionGate } from "@/components/permission-gate";

export const Route = createFileRoute("/_authenticated/reporting/payments")({
  component: () => <PermissionGate permission="reporting.payments.view"><PaymentsReportsPage /></PermissionGate>,
});
