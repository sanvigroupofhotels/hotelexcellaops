import { createFileRoute } from "@tanstack/react-router";
import { Analytics } from "./analytics";
import { AdminOnly } from "@/components/admin-only";

export const Route = createFileRoute("/_authenticated/reporting/analytics")({
  component: () => <AdminOnly><Analytics /></AdminOnly>,
});
