import { createFileRoute } from "@tanstack/react-router";
import { PaymentsReportsPage } from "./payments-reports";

export const Route = createFileRoute("/_authenticated/reporting/payments")({
  component: PaymentsReportsPage,
});
