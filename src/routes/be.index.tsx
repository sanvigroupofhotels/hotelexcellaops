import { createFileRoute, redirect } from "@tanstack/react-router";

// Backward-compat: /be → /booking-engine
export const Route = createFileRoute("/be/")({
  beforeLoad: () => {
    throw redirect({ to: "/booking-engine", replace: true });
  },
});
