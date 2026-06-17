import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Topbar } from "@/components/topbar";
import { AdminOnly } from "@/components/admin-only";
import { cn } from "@/lib/utils";
import {
  Building2, Cog, Palette, ShieldCheck, Plug,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsLayout });

export const SETTINGS_TABS = [
  { to: "/settings/general",      label: "General",             icon: Building2 },
  { to: "/settings/operations",   label: "Operations",          icon: Cog },
  { to: "/settings/branding",     label: "Branding",            icon: Palette },
  { to: "/settings/documents",    label: "Documents Retention", icon: ShieldCheck },
  { to: "/settings/integrations", label: "Integrations",        icon: Plug },
] as const;

function SettingsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <AdminOnly>
      <Topbar title="Settings" subtitle="Configure your hotel, operations, branding, retention and integrations" />
      <div className="px-4 md:px-6 py-5 md:py-8 max-w-[1100px] space-y-5">
        <div className="luxe-card rounded-xl p-2 flex gap-1 overflow-x-auto">
          {SETTINGS_TABS.map((t) => {
            const active = pathname === t.to || pathname.startsWith(t.to + "/");
            const Icon = t.icon;
            return (
              <Link key={t.to} to={t.to}
                className={cn("shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs whitespace-nowrap",
                  active ? "bg-gold-soft text-gold border border-gold/40" : "text-muted-foreground hover:text-foreground")}>
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </Link>
            );
          })}
        </div>
        <Outlet />
      </div>
    </AdminOnly>
  );
}
