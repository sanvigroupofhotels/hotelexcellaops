import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Topbar } from "@/components/topbar";
import { AdminOnly } from "@/components/admin-only";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsLayout });

/**
 * Settings is a sidebar-driven layout. The expandable sidebar group already
 * exposes each sub-page (General, Operations, Branding, Documents Retention,
 * Integrations) as an independent route — there is no horizontal tab strip
 * here on purpose. One Settings navigation model across the PMS.
 */
function SettingsLayout() {
  return (
    <AdminOnly>
      <Topbar title="Settings" subtitle="Configure your hotel, operations, branding, retention and integrations" />
      <div className="px-4 md:px-6 py-5 md:py-8 max-w-[1100px]">
        <Outlet />
      </div>
    </AdminOnly>
  );
}
