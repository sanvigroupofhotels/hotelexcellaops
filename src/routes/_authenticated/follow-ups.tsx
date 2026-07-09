import { createFileRoute, Navigate } from "@tanstack/react-router";

/**
 * Follow-ups were tied to the removed Quotes surface. The Notification Bell
 * (top-right) is the canonical inbox in HEOS v1.0; deep links now redirect
 * to the CRM Analytics screen where lead/quote history is surfaced.
 */
export const Route = createFileRoute("/_authenticated/follow-ups")({
  component: () => <Navigate to="/reporting/crm-analytics" replace />,
});
