import { Link, useRouterState } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Menu, X, BedDouble, Wallet,
  MessageSquareWarning, Building2, Database,
  Home, FileBarChart, UserCog, Settings as SettingsIcon, ChevronDown,
  Cog, Palette, ShieldCheck, Plug, Building2 as Building2Alt,
  BarChart3, IndianRupee, Receipt, UsersRound, CreditCard, KeyRound,
} from "lucide-react";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/hooks/use-role";
import { UserMenu } from "@/components/user-menu";

type NavItem = { to: string; label: string; icon: any; adminOnly?: boolean; managerOnly?: boolean };

const nav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: Home },
  // Bookings list — only Owner/Admin (Reception/Staff use House View). Direct URL
  // is also blocked by a beforeLoad gate on the /bookings route.
  { to: "/bookings", label: "Bookings", icon: BedDouble, managerOnly: true },
  { to: "/house-view", label: "House View", icon: Building2 },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/dues", label: "Due Collection", icon: Receipt },
  { to: "/cash", label: "CashBook", icon: Wallet },
  // Reporting is rendered separately as an expandable group below.
  { to: "/staff-management", label: "Staff Management", icon: UserCog },
  { to: "/complaints", label: "Complaints", icon: MessageSquareWarning },
  { to: "/master-data", label: "Master Data", icon: Database, adminOnly: true },
];

const reportingChildren = [
  { to: "/reporting/analytics",   label: "Analytics",            icon: BarChart3 },
  { to: "/reporting/payments",    label: "Payment Reports",      icon: IndianRupee },
  { to: "/reporting/staff",       label: "Staff Reporting",      icon: FileBarChart, adminOnly: true },
  { to: "/reporting/night-audit", label: "Night Audit History",  icon: ShieldCheck, adminOnly: true },
] as const;

const usersChildren = [
  { to: "/users/management", label: "User Management", icon: UsersRound },
  { to: "/users/roles",      label: "Role Management", icon: ShieldCheck },
  { to: "/users/access",     label: "Access Management", icon: KeyRound },
] as const;

const settingsChildren = [
  { to: "/settings/general",          label: "General",             icon: Building2Alt },
  { to: "/settings/operations",       label: "Operations",          icon: Cog },
  { to: "/settings/branding",         label: "Branding",            icon: Palette },
  { to: "/settings/documents",        label: "Documents Retention", icon: ShieldCheck },
  { to: "/settings/payment-settings", label: "Payment Settings",    icon: CreditCard },
  { to: "/settings/integrations",     label: "Integrations",        icon: Plug },
] as const;

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-3 px-2 py-1 group">
      <div className="h-10 w-10 rounded-md gold-gradient flex items-center justify-center shadow-[0_0_24px_oklch(0.82_0.13_82/0.25)]">
        <span className="font-display text-xl font-semibold text-charcoal">H</span>
      </div>
      <div className="leading-tight">
        <div className="font-display text-base tracking-wide text-foreground">HOTEL EXCELLA</div>
        <div className="text-[10px] tracking-[0.25em] text-gold/80 uppercase">Boutique · Luxury</div>
      </div>
    </Link>
  );
}

/**
 * Generic expandable group used for Reporting and Settings.
 * Both subsections follow the same pattern: clicking opens an inline list of
 * child routes; the parent has no page of its own.
 */
function ExpandableGroup({
  label, icon: Icon, prefix, children, onNavigate, pathname,
}: {
  label: string;
  icon: any;
  prefix: string;
  children: ReadonlyArray<{ to: string; label: string; icon: any; adminOnly?: boolean }>;
  onNavigate?: () => void;
  pathname: string;
}) {
  const { isAdmin } = useUserRole();
  const sectionActive = pathname.startsWith(prefix);
  const [open, setOpen] = useState(sectionActive);
  useEffect(() => { if (sectionActive) setOpen(true); }, [sectionActive]);

  const visible = children.filter((c) => !c.adminOnly || isAdmin);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-all duration-200",
          sectionActive ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
        )}
        aria-expanded={open}
      >
        {sectionActive && (
          <motion.div layoutId="sidebar-active" className="absolute inset-0 rounded-md bg-gold-soft border border-gold/30"
            transition={{ type: "spring", stiffness: 380, damping: 30 }} />
        )}
        <Icon className={cn("relative h-4 w-4 shrink-0", sectionActive && "text-gold")} />
        <span className="relative flex-1 text-left">{label}</span>
        <ChevronDown className={cn("relative h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }} className="overflow-hidden"
          >
            <div className="pl-7 mt-1 space-y-0.5">
              {visible.map((c) => {
                const active = pathname === c.to || pathname.startsWith(c.to + "/");
                const ChildIcon = c.icon;
                return (
                  <Link key={c.to} to={c.to} onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] transition",
                      active ? "text-gold bg-gold-soft/60 border border-gold/30" : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40",
                    )}>
                    <ChildIcon className="h-3.5 w-3.5" /> {c.label}
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isAdmin, canManage } = useUserRole();
  const visible = nav.filter((n) => {
    if (n.adminOnly && !isAdmin) return false;
    // managerOnly = Owner or Admin (canManage). Reception/Staff use House View.
    if (n.managerOnly && !canManage) return false;
    return true;
  });
  return (
    <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
      {visible.map((item, i) => {
        const active = pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to));
        const Icon = item.icon;
        return (
          <motion.div
            key={item.to}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.03 * i, duration: 0.3 }}
          >
            <Link
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-all duration-200 group",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
              )}
            >
              {active && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-md bg-gold-soft border border-gold/30"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <Icon className={cn("relative h-4 w-4 shrink-0", active && "text-gold")} />
              <span className="relative flex-1">{item.label}</span>
            </Link>
          </motion.div>
        );
      })}
      {/* Reporting group — visible to all signed-in staff (admin-only children are filtered inside) */}
      <ExpandableGroup
        label="Reporting" icon={FileBarChart} prefix="/reporting"
        children={reportingChildren} onNavigate={onNavigate} pathname={pathname}
      />
      {/* Users group — admin only */}
      {isAdmin && (
        <ExpandableGroup
          label="Users" icon={UsersRound} prefix="/users"
          children={usersChildren} onNavigate={onNavigate} pathname={pathname}
        />
      )}
      {/* Settings group — admin only */}
      {isAdmin && (
        <ExpandableGroup
          label="Settings" icon={SettingsIcon} prefix="/settings"
          children={settingsChildren} onNavigate={onNavigate} pathname={pathname}
        />
      )}
    </nav>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-6 flex items-center justify-between">
        <Logo />
        <div className="md:hidden">
          <UserMenu />
        </div>
      </div>
      <div className="luxe-divider mx-4 mb-4" />
      <NavItems onNavigate={onNavigate} />
      <div className="hidden md:flex items-center justify-between gap-2 px-3 py-3 border-t border-border/50">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Account</span>
        <UserMenu />
      </div>
    </div>
  );
}

export function AppSidebar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-background/80 backdrop-blur-lg border-b border-border print:hidden">
        <Logo />
        <div className="flex items-center gap-2">
          <UserMenu />
          <button onClick={() => setOpen(true)} className="p-2 rounded-md text-muted-foreground hover:text-foreground" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 md:hidden print:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <motion.aside
            initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="absolute left-0 top-0 h-full w-72 bg-sidebar border-r border-sidebar-border"
          >
            <button onClick={() => setOpen(false)} className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </motion.aside>
        </motion.div>
      )}

      <aside className="hidden md:flex fixed inset-y-0 left-0 w-64 bg-sidebar border-r border-sidebar-border flex-col z-30 print:hidden">
        <SidebarContent />
      </aside>
    </>
  );
}
