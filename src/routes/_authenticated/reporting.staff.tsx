import { createFileRoute } from "@tanstack/react-router";
import { Reports } from "./reports";
import { AdminOnly } from "@/components/admin-only";

export const Route = createFileRoute("/_authenticated/reporting/staff")({
  component: () => <AdminOnly><Reports /></AdminOnly>,
});
