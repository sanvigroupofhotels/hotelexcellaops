import { createFileRoute, Navigate } from "@tanstack/react-router";

/**
 * Legacy URL — Audit History was moved under End of Day in the
 * "Backlog Consolidation" shipment. Kept for one release as a redirect so
 * bookmarks and old links continue to work.
 */
export const Route = createFileRoute("/_authenticated/reporting/night-audit")({
  component: () => <Navigate to="/night-audit/history" replace />,
});
