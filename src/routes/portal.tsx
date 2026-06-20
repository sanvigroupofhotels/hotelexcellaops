/**
 * /portal layout — host-routed for guest.hotelexcella.in.
 * Pathless wrapper so /portal (landing) and /portal/$token (existing) coexist.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/portal")({
  component: () => <Outlet />,
});
