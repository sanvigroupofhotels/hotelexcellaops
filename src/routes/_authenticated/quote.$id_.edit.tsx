import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/quote/$id_/edit")({
  component: () => <Navigate to="/bookings" replace />,
});
