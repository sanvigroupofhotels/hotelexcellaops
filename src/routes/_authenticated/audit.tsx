import { createFileRoute, Navigate } from "@tanstack/react-router";

/** Quote↔Booking sync audit — obsolete after Shipment 3B removed Quotes UI. */
export const Route = createFileRoute("/_authenticated/audit")({
  component: () => <Navigate to="/reporting/activity" replace />,
});
