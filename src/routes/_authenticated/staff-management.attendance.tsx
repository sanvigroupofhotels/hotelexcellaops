import { createFileRoute } from "@tanstack/react-router";
import { AttendancePage } from "./attendance";

export const Route = createFileRoute("/_authenticated/staff-management/attendance")({
  component: AttendancePage,
});
