import { Search } from "lucide-react";
import { motion } from "framer-motion";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notification-bell";

export function Topbar({
  title,
  subtitle,
  action,
  search,
  toolbar,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** Page-provided working search; replaces the generic placeholder search. */
  search?: React.ReactNode;
  /** Optional compact page controls rendered inside the header (desktop). */
  toolbar?: React.ReactNode;
}) {
  const compact = !!toolbar;
  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`hidden md:flex sticky top-0 z-20 items-center justify-between gap-3 bg-background/70 backdrop-blur-xl border-b border-border ${compact ? "px-6 py-2.5" : "px-8 py-5"}`}
    >
      <div className="min-w-0 shrink-0">
        <h1 className={`font-display text-foreground truncate ${compact ? "text-xl" : "text-2xl"}`}>{title}</h1>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
      </div>
      {toolbar && <div className="min-w-0 flex-1 flex justify-center">{toolbar}</div>}
      <div className="flex items-center gap-3 shrink-0">
        {search ?? (
          <div className="hidden lg:flex items-center gap-2 px-3 py-2 rounded-md bg-card border border-border w-64">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search bookings, guests…"
              className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground/60"
            />
            <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">⌘K</kbd>
          </div>
        )}
        <ThemeToggle />
        <NotificationBell variant="desktop" />
        <div className="h-9 w-9 rounded-full gold-gradient flex items-center justify-center text-charcoal font-semibold text-sm shadow-[0_0_18px_oklch(0.82_0.13_82/0.2)]">
          HE
        </div>
        {action}
      </div>
    </motion.header>
  );
}
