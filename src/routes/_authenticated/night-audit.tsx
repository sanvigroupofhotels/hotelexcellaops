import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/night-audit")({
  component: () => <Outlet />,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">
      Failed to load End of Day: {(error as Error)?.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6">Not found</div>,
});
