import { createFileRoute, Navigate } from "@tanstack/react-router";

/** Legacy quote-generation surface — replaced by direct Booking flow. */
export const Route = createFileRoute("/_authenticated/generate")({
  component: () => <Navigate to="/bookings/new" replace />,
});
