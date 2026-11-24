import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/utilities/")({
  beforeLoad: () => { throw redirect({ to: "/utilities/payment-links" }); },
});
