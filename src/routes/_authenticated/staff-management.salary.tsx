import { createFileRoute } from "@tanstack/react-router";
import { SalaryPage } from "./salary";

export const Route = createFileRoute("/_authenticated/staff-management/salary")({
  component: SalaryPage,
});
