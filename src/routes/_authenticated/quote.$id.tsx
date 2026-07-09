import { createFileRoute, Navigate } from "@tanstack/react-router";

/**
 * Quotes were removed from the operator UI in HEOS v1.0 Shipment 3B.
 * The DB tables remain read-only for historical audit. Any old links redirect
 * to the Bookings list — the correct entry point for all guest-facing pricing.
 */
export const Route = createFileRoute("/_authenticated/quote/$id")({
  component: () => <Navigate to="/bookings" replace />,
});
