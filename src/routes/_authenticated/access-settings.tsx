import { createFileRoute, Navigate } from "@tanstack/react-router";

/** Back-compat redirect — Access Management moved under Users hierarchy. */
export const Route = createFileRoute("/_authenticated/access-settings")({
  component: () => <Navigate to="/users/roles" />,
});
