import { createFileRoute, Navigate } from "@tanstack/react-router";

/**
 * Access Management lives under Settings now. The actual UI is shared with
 * the standalone /access-settings page so old bookmarks continue to work.
 */
export const Route = createFileRoute("/_authenticated/settings/access")({
  component: () => <Navigate to="/access-settings" replace />,
});
