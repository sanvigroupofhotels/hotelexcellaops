import { useEffect, useState } from "react";
import { Bell, Trash2, ArrowRight, Check } from "lucide-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  listNotifications, unreadNotificationCount,
  markNotificationRead, dismissAllVisibleNotifications, deleteNotification,
  notificationHref, type NotificationRow,
} from "@/lib/notifications-api";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/**
 * Single Notification Bell. Mounted in two places (desktop topbar and mobile
 * header) but only renders for the active viewport — guaranteeing one active
 * subscription at any time. Realtime fan-out + a 60s polling fallback keep
 * counts in sync across tabs and devices; a BroadcastChannel mirrors local
 * reads/dismissals across same-origin tabs instantly.
 */
export function NotificationBell({
  className,
  variant = "desktop",
}: { className?: string; variant?: "desktop" | "mobile" }) {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const active = variant === "mobile" ? isMobile : !isMobile;

  const { data: count = 0 } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: unreadNotificationCount,
    refetchInterval: 60_000,
    enabled: active,
  });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => listNotifications(50),
    enabled: active && open,
    // Re-poll while open as a safety net so an open Notification Center
    // updates even when Realtime is unreachable.
    refetchInterval: open ? 30_000 : false,
  });

  // Realtime + cross-tab subscriptions. Handlers registered BEFORE subscribe.
  // Failures never throw; the polling fallback above keeps state live.
  useEffect(() => {
    if (!active) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let bc: BroadcastChannel | null = null;
    const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications"] });
    try {
      const topic = `notifications-bell-${variant}-${Math.random().toString(36).slice(2, 8)}`;
      channel = supabase.channel(topic);
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => {
          invalidate();
          try { bc?.postMessage({ kind: "remote-change" }); } catch { /* noop */ }
        },
      );
      channel.subscribe(() => { /* CHANNEL_ERROR / TIMED_OUT fall through to polling */ });
    } catch {
      // Realtime unavailable — polling fallback continues to work.
    }
    try {
      if (typeof BroadcastChannel !== "undefined") {
        bc = new BroadcastChannel("excella-notifications");
        bc.onmessage = () => invalidate();
      }
    } catch { /* noop */ }
    return () => {
      if (channel) { try { supabase.removeChannel(channel); } catch { /* noop */ } }
      if (bc) { try { bc.close(); } catch { /* noop */ } }
    };
  }, [qc, active, variant]);

  if (!active) return null;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const broadcast = () => {
    try {
      if (typeof BroadcastChannel !== "undefined") {
        const bc = new BroadcastChannel("excella-notifications");
        bc.postMessage({ kind: "local-change" });
        bc.close();
      }
    } catch { /* noop */ }
  };
  const afterMutate = () => { invalidate(); broadcast(); };

  const readOne = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: afterMutate,
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const dismissAll = useMutation({
    mutationFn: dismissAllVisibleNotifications,
    onSuccess: () => { afterMutate(); toast.success("All notifications dismissed"); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const del = useMutation({
    mutationFn: deleteNotification,
    onSuccess: afterMutate,
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  // Popover shows only the 8 most recent — heavy lifting lives in the
  // Notifications workspace inside Follow-ups.
  const recent = items.slice(0, 8);
  const hasAny = items.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Notifications"
          className={cn(
            "relative p-2.5 rounded-md bg-card border border-border hover:border-gold/40 transition",
            className,
          )}
        >
          <Bell className="h-4 w-4 text-muted-foreground" />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-gold text-charcoal text-[10px] font-bold flex items-center justify-center">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(380px,calc(100vw-1rem))] p-0 max-h-[70vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <div className="font-display text-sm">Notifications</div>
            <div className="text-[11px] text-muted-foreground">{count} unread</div>
          </div>
          {hasAny && (
            <button
              onClick={() => {
                if (!confirm("Permanently dismiss all visible notifications?")) return;
                dismissAll.mutate();
              }}
              disabled={dismissAll.isPending}
              className="text-[11px] text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
            >
              <Trash2 className="h-3 w-3" /> Dismiss All
            </button>
          )}
        </div>
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Loading…</div>
          ) : recent.length === 0 ? (
            <div className="p-8 text-center">
              <Bell className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <div className="text-xs text-muted-foreground">No notifications yet</div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((n) => (
                <NotificationItem
                  key={n.id}
                  n={n}
                  onRead={() => readOne.mutate(n.id)}
                  onDelete={() => del.mutate(n.id)}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </ul>
          )}
        </div>
        <Link
          to="/notifications"
          onClick={() => setOpen(false)}
          className="border-t border-border px-4 py-2.5 text-xs font-medium text-gold inline-flex items-center justify-center gap-1.5 hover:bg-gold-soft/30 w-full"
        >
          View All Notifications <ArrowRight className="h-3 w-3" />
        </Link>

      </PopoverContent>
    </Popover>
  );
}

function NotificationItem({
  n, onRead, onDelete, onNavigate,
}: {
  n: NotificationRow;
  onRead: () => void;
  onDelete: () => void;
  onNavigate: () => void;
}) {
  const href = notificationHref(n);
  const isUnread = n.status === "unread";
  const priorityDot =
    n.priority === "urgent" ? "bg-red-500" :
    n.priority === "high"   ? "bg-amber-500" :
    n.priority === "low"    ? "bg-muted-foreground/40" : "bg-gold";

  const content = (
    <div className={cn(
      "flex gap-3 px-4 py-3 hover:bg-muted/40 transition cursor-pointer",
      isUnread && "bg-muted/20",
    )}>
      <span className={cn("mt-1.5 h-2 w-2 rounded-full flex-shrink-0", priorityDot)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className={cn("text-xs font-medium", isUnread ? "text-foreground" : "text-muted-foreground")}>
            {n.title}
          </div>
          <span className="text-[10px] text-muted-foreground flex-shrink-0">{timeAgo(n.created_at)}</span>
        </div>
        <div className="text-[11px] text-muted-foreground whitespace-pre-line mt-0.5 line-clamp-3">
          {n.body}
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          {isUnread && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRead(); }}
              className="text-[10px] text-gold hover:underline inline-flex items-center gap-1"
            >
              <Check className="h-3 w-3" /> Mark read
            </button>
          )}
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
            className="text-[10px] text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
          >
            <Trash2 className="h-3 w-3" /> Dismiss
          </button>
        </div>
      </div>
    </div>
  );

  if (href) {
    return (
      <li>
        <Link
          to={href}
          onClick={() => { if (isUnread) onRead(); onNavigate(); }}
          className="block"
        >
          {content}
        </Link>
      </li>
    );
  }
  return <li onClick={() => isUnread && onRead()}>{content}</li>;
}
