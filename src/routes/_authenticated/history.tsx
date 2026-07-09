import { createFileRoute, Navigate } from "@tanstack/react-router";

/** Legacy quote history — replaced by Bookings list. */
export const Route = createFileRoute("/_authenticated/history")({
  component: () => <Navigate to="/bookings" replace />,
});
