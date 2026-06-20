import { createFileRoute, redirect } from "@tanstack/react-router";

// Backward-compat: /be/* → /booking-engine/*
export const Route = createFileRoute("/be/$")({
  beforeLoad: ({ params, location }) => {
    const splat = (params as any)._splat ?? "";
    throw redirect({
      href: `/booking-engine${splat ? `/${splat}` : ""}${location.searchStr ?? ""}`,
      replace: true,
    });
  },
});
