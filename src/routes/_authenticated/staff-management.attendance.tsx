import { createFileRoute } from "@tanstack/react-router";
import { AttendancePage } from "./attendance";
import { PermissionGate } from "@/components/permission-gate";

export const Route = createFileRoute("/_authenticated/staff-management/attendance")({
  component: () => <PermissionGate permission="staff.attendance"><AttendancePage /></PermissionGate>,
});
