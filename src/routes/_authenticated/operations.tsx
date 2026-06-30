import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Topbar } from "@/components/topbar";

export const Route = createFileRoute("/_authenticated/operations")({ component: OpsLayout });

function OpsLayout() {
  return (
    <>
      <Topbar title="Operations" subtitle="Inventory, vendors and supplies for daily hotel operations" />
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-[1200px]">
        <Outlet />
      </div>
    </>
  );
}
