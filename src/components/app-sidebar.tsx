import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  LayoutDashboard, FilePlus, History, Bell, Calendar, BarChart3,
  Users, ListChecks, HelpCircle, Settings, Menu, X, LogOut,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/generate", label: "Generate Quote", icon: FilePlus },
  { to: "/history", label: "Quotes", icon: History },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/follow-ups", label: "Follow-ups", icon: Bell },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
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

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
      {nav.map((item, i) => {
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
    </nav>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const initials = (user?.user_metadata?.display_name || user?.email || "?")
    .split(/[\s@]/).filter(Boolean).slice(0, 2)
    .map((s: string) => s[0]?.toUpperCase()).join("");

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-6"><Logo /></div>
      <div className="luxe-divider mx-4 mb-4" />
      <NavItems onNavigate={onNavigate} />
      <div className="px-3 py-4 space-y-1 border-t border-border/50">
        <div className="flex items-center gap-3 px-3 py-2 rounded-md">
          <div className="h-8 w-8 rounded-full bg-gold-soft border border-gold/30 flex items-center justify-center text-xs font-medium text-gold">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-foreground truncate">
              {user?.user_metadata?.display_name || user?.email}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">{user?.email}</div>
          </div>
        </div>
        <button className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60 transition">
          <HelpCircle className="h-4 w-4" /> Help & Support
        </button>
        <button className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60 transition">
          <Settings className="h-4 w-4" /> Settings
        </button>
        <button
          onClick={async () => {
            await signOut();
            toast.success("Signed out");
            navigate({ to: "/login" });
          }}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
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
        <button onClick={() => setOpen(true)} className="p-2 rounded-md text-muted-foreground hover:text-foreground" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>
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
