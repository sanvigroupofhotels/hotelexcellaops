import { Link, useRouterState } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Menu, X, BedDouble, Wallet,
  MessageSquareWarning, Building2, Database,
  Home, FileBarChart, UserCog, Settings as SettingsIcon, ChevronDown,
  Cog, Palette, ShieldCheck, Plug, Building2 as Building2Alt,
  BarChart3, IndianRupee, Receipt, UsersRound, CreditCard, KeyRound, Moon, AlertTriangle, TrendingUp, CalendarDays,
  Boxes, Truck, ListChecks,
} from "lucide-react";
import { useNightAuditStatus } from "@/hooks/use-night-audit-status";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/hooks/use-role";
import { usePermissions } from "@/hooks/use-permissions";
import { UserMenu } from "@/components/user-menu";
import { NotificationBell as MobileNotificationBell } from "@/components/notification-bell";

type NavItem = { to: string; label: string; icon: any; adminOnly?: boolean; managerOnly?: boolean; permission?: string; anyOf?: string[] };

// Order matters — items hidden by permission are skipped silently, so a single
// admin-order list also yields the correct Reception order (Bookings hidden).
const nav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: Home, permission: "dashboard.view" },
  { to: "/house-view", label: "House View", icon: Building2, permission: "house_view.view" },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, adminOnly: true },
  // Bookings list — only Owner/Admin (Reception/Staff use House View).
  { to: "/bookings", label: "Bookings", icon: BedDouble, permission: "bookings.view" },
  // End of Day group is rendered inline below (between Bookings and Due Collection).
  { to: "/dues", label: "Due Collection", icon: Receipt, permission: "dues.view" },
  { to: "/cash", label: "CashBook", icon: Wallet, permission: "cash.view" },
  { to: "/complaints", label: "Complaints", icon: MessageSquareWarning, permission: "complaints.view" },
  { to: "/customers", label: "Customers", icon: Users, permission: "customers.view" },
  { to: "/staff-management", label: "Staff Management", icon: UserCog, anyOf: ["staff.master", "staff.attendance", "staff.salary"] },
  { to: "/master-data", label: "Master Data", icon: Database, anyOf: ["master.rooms", "master.rates", "master.others"] },
];

const endOfDayChildren = [
  { to: "/night-audit",                   label: "Dashboard",        icon: Home,        permission: "house_view.view" },
  { to: "/night-audit/critical-tasks",    label: "Critical Tasks",   icon: AlertTriangle, permission: "house_view.view" },
  { to: "/night-audit/eod-report",        label: "End of Day Report",icon: FileBarChart, permission: "house_view.view" },
  { to: "/night-audit/history",           label: "Audit History",    icon: ShieldCheck, permission: "reporting.night_audit.view" },
] as const;

const inventoryChildren = [
  { to: "/operations/inventory",         label: "Inventory Items",       icon: Boxes },
  { to: "/operations/vendors",           label: "Vendors",               icon: Truck },
] as const;

const housekeepingChildren = [
  { to: "/housekeeping",                 label: "Today's Tasks",         icon: ListChecks },
  { to: "/operations/linen-types",       label: "Linen Types",           icon: ListChecks, adminOnly: true },
  { to: "/operations/hk-issue-types",    label: "Housekeeping Issues",   icon: ListChecks, adminOnly: true },
] as const;

const reportingChildren = [
  { to: "/reporting/owner-dashboard", label: "Owner Dashboard",     icon: BarChart3, permission: "reporting.analytics.view", adminOnly: true },
  { to: "/reporting/crm-analytics",   label: "CRM Analytics",       icon: TrendingUp, permission: "reporting.analytics.view" },
  { to: "/reporting/payments",        label: "Payment Reports",     icon: IndianRupee, permission: "reporting.payments.view" },
  { to: "/reporting/housekeeping",    label: "Housekeeping",        icon: ListChecks, permission: "reporting.housekeeping.view" },
  { to: "/reporting/laundry",         label: "Laundry",             icon: Truck, permission: "reporting.laundry.view" },
  { to: "/reporting/staff",           label: "Staff Reporting",     icon: FileBarChart, permission: "reporting.staff.view" },
  { to: "/reporting/activity",        label: "Activity Tracking",   icon: ShieldCheck },
] as const;

const usersChildren = [
  { to: "/users/management", label: "User Management", icon: UsersRound, permission: "users.manage_users" },
  { to: "/users/roles",      label: "Role Management", icon: ShieldCheck, permission: "users.manage_roles" },
  { to: "/users/access",     label: "Access Management", icon: KeyRound, permission: "users.manage_access" },
] as const;

const settingsChildren = [
  { to: "/settings/general",          label: "General",             icon: Building2Alt, permission: "settings.general" },
  { to: "/settings/operations",       label: "Operations",          icon: Cog, permission: "settings.operations" },
  { to: "/settings/branding",         label: "Branding",            icon: Palette, permission: "settings.branding" },
  { to: "/settings/crm",              label: "CRM & Notifications", icon: Users, permission: "settings.general" },
  { to: "/settings/documents",        label: "Documents Retention", icon: ShieldCheck, permission: "settings.documents" },
  { to: "/settings/payment-settings", label: "Payment Settings",    icon: CreditCard, permission: "settings.payment_settings" },
  { to: "/settings/integrations",     label: "Integrations",        icon: Plug, permission: "settings.integrations" },
] as const;

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-3 px-2 py-1 group">
      <div className="h-10 w-10 rounded-md gold-gradient flex items-center justify-center shadow-[0_0_24px_oklch(0.82_0.13_82/0.25)]">
        <span className="font-display text-xl font-semibold text-charcoal">H</span>
      </div>
      <div className="leading-tight">
        <div className="font-display text-base tracking-wide text-foreground">HOTEL EXCELLA</div>
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
  label, icon: Icon, prefix, children, onNavigate, pathname, badge,
}: {
  label: string;
  icon: any;
  prefix: string;
  children: ReadonlyArray<{ to: string; label: string; icon: any; adminOnly?: boolean; permission?: string; anyOf?: string[] }>;
  onNavigate?: () => void;
  pathname: string;
  badge?: number;
}) {
  const { isAdmin } = useUserRole();
  const { has, hasAny, isLoading } = usePermissions();
  const sectionActive = pathname.startsWith(prefix);
  const [open, setOpen] = useState(sectionActive);
  useEffect(() => { if (sectionActive) setOpen(true); }, [sectionActive]);

  const visible = children.filter((c) => {
    if (isLoading) return false;
    if (c.adminOnly && !isAdmin) return false;
    if (c.permission && !has(c.permission)) return false;
    if (c.anyOf && !hasAny(c.anyOf)) return false;
    return true;
  });

  if (visible.length === 0) return null;

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
        {typeof badge === "number" && badge > 0 && (
          <span className="relative inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold tabular-nums">
            {badge}
          </span>
        )}
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
  const { isAdmin, canManage, isHousekeeping } = useUserRole();
  const { has, hasAny, isLoading } = usePermissions();
  const naStatus = useNightAuditStatus();

  // Housekeeping role: sidebar collapses to a single "Today's Tasks" entry.
  if (isHousekeeping) {
    const active = pathname === "/housekeeping" || pathname.startsWith("/housekeeping/");
    return (
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        <Link
          to="/housekeeping"
          onClick={onNavigate}
          className={cn(
            "relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-all duration-200",
            active ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
          )}
        >
          {active && (
            <motion.div layoutId="sidebar-active" className="absolute inset-0 rounded-md bg-gold-soft border border-gold/30"
              transition={{ type: "spring", stiffness: 380, damping: 30 }} />
          )}
          <ListChecks className={cn("relative h-4 w-4 shrink-0", active && "text-gold")} />
          <span className="relative flex-1">Today's Tasks</span>
        </Link>
      </nav>
    );
  }

  const visible = nav.filter((n) => {
    if (isLoading) return false;
    if (n.adminOnly && !isAdmin) return false;
    if (n.managerOnly && !canManage) return false;
    if (n.permission && !has(n.permission)) return false;
    if (n.anyOf && !hasAny(n.anyOf)) return false;
    return true;
  });
  return (
    <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
      {visible.map((item, i) => {
        const active = pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to));
        const Icon = item.icon;
        return (
          <div key={item.to}>
            <motion.div
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
            {(item.to === "/bookings"
              || (item.to === "/house-view" && !visible.some((v) => v.to === "/bookings"))) && (
              <ExpandableGroup
                label="End of Day" icon={Moon} prefix="/night-audit"
                children={endOfDayChildren} onNavigate={onNavigate} pathname={pathname}
                badge={(naStatus.data?.pendingCount ?? 0) > 0 ? naStatus.data!.pendingCount : undefined}
              />
            )}
          </div>
        );
      })}
      {/* Housekeeping group — Today's Tasks + Linen Types + Issue Types */}
      <ExpandableGroup
        label="Housekeeping" icon={ListChecks} prefix="/housekeeping"
        children={housekeepingChildren} onNavigate={onNavigate} pathname={pathname}
      />
      {/* Laundry — sits next to Housekeeping in the sidebar. */}
      {(() => {
        const active = pathname === "/laundry" || pathname.startsWith("/laundry/");
        return (
          <Link
            to="/laundry"
            onClick={onNavigate}
            className={cn(
              "relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-all duration-200",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60",
            )}
          >
            {active && (
              <motion.div layoutId="sidebar-active" className="absolute inset-0 rounded-md bg-gold-soft border border-gold/30"
                transition={{ type: "spring", stiffness: 380, damping: 30 }} />
            )}
            <Truck className={cn("relative h-4 w-4 shrink-0", active && "text-gold")} />
            <span className="relative flex-1">Laundry</span>
          </Link>
        );
      })()}
      {/* Inventory (promoted from Operations menu). Charge Catalog moved to
          Master Data → Finance; Linen / HK Issues moved into Housekeeping. */}
      <ExpandableGroup
        label="Inventory" icon={Boxes} prefix="/operations"
        children={inventoryChildren} onNavigate={onNavigate} pathname={pathname}
      />
      <ExpandableGroup
        label="Reporting" icon={FileBarChart} prefix="/reporting"
        children={reportingChildren} onNavigate={onNavigate} pathname={pathname}
      />
      <ExpandableGroup
        label="Users" icon={UsersRound} prefix="/users"
        children={usersChildren} onNavigate={onNavigate} pathname={pathname}
      />
      <ExpandableGroup
        label="Settings" icon={SettingsIcon} prefix="/settings"
        children={settingsChildren} onNavigate={onNavigate} pathname={pathname}
      />
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
          <MobileNotificationBell variant="mobile" />
          <UserMenu />
          <button onClick={() => setOpen(true)} className="p-2 rounded-md text-muted-foreground hover:text-foreground" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] md:hidden print:hidden">
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
