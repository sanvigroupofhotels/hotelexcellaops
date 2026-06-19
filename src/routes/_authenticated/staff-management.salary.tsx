import { createFileRoute } from "@tanstack/react-router";
import { SalaryPage } from "./salary";
import { PermissionGate } from "@/components/permission-gate";

export const Route = createFileRoute("/_authenticated/staff-management/salary")({
  component: () => <PermissionGate permission="staff.salary"><SalaryPage /></PermissionGate>,
});
