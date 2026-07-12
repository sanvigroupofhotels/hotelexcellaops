import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import {
  listAllNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  markNotificationsRead,
  dismissNotifications,
  notificationHref,
  type NotificationRow as NotificationRowType,
} from "@/lib/notifications-api";
import { Bell, Search, Check, CheckCheck, Trash2, Loader2, X, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";


export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotificationCenter,
});

/**
 * Notification Center — full history, search, filters, mark read, bulk
 * actions. Complements the topbar bell (which only shows the 8 most recent).
 * This page also becomes the primary notification timeline surface for the
 * forthcoming Excella AI OS event stream.
 */
function NotificationCenter() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"active" | "unread" | "read" | "dismissed">("active");
  const [type, setType] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["notifications", "center", status, type, search],
    queryFn: () => listAllNotifications({ status, type: type || undefined, search: search || undefined, limit: 500 }),
    staleTime: 30_000,
  });

  // Derive available types from what we can see.
  const availableTypes = useMemo(() => {
    const s = new Set<string>();
    for (const n of items) s.add(n.type);
    return Array.from(s).sort();
  }, [items]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications"] });

  const readOne = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const bulkRead = useMutation({
    mutationFn: (ids: string[]) => markNotificationsRead(ids),
    onSuccess: () => { invalidate(); setSelected(new Set()); toast.success("Marked read"); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const bulkDismiss = useMutation({
    mutationFn: (ids: string[]) => dismissNotifications(ids),
    onSuccess: () => { invalidate(); setSelected(new Set()); toast.success("Dismissed"); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => { invalidate(); toast.success("All marked read"); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((n) => n.id)));
  };

  const unreadCount = items.filter((n) => n.status === "unread").length;

  return (
    <>
      <Topbar title="Notifications" subtitle="Complete history — search, filter, bulk actions" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1100px] space-y-4">
        {/* Filters */}
        <div className="luxe-card rounded-xl p-3 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            {(["active", "unread", "read", "dismissed"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium border transition capitalize",
                  status === s
                    ? "border-gold bg-gold-soft text-foreground"
                    : "border-border text-muted-foreground hover:bg-secondary/50",
                )}
              >
                {s}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                  className="text-xs inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 hover:border-gold/40"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, body, reference…"
                className="w-full bg-input/60 border border-border rounded-md pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="relative">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="bg-input/60 border border-border rounded-md pl-8 pr-3 py-2 text-sm"
              >
                <option value="">All types</option>
                {availableTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Bulk toolbar */}
        {selected.size > 0 && (
          <div className="luxe-card rounded-xl p-3 flex flex-wrap items-center gap-2">
            <div className="text-xs font-medium">{selected.size} selected</div>
            <button
              onClick={() => bulkRead.mutate(Array.from(selected))}
              disabled={bulkRead.isPending}
              className="text-xs inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 hover:border-gold/40"
            >
              <Check className="h-3.5 w-3.5" /> Mark read
            </button>
            <button
              onClick={() => { if (confirm(`Dismiss ${selected.size} notifications?`)) bulkDismiss.mutate(Array.from(selected)); }}
              disabled={bulkDismiss.isPending}
              className="text-xs inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-destructive hover:bg-destructive/20"
            >
              <Trash2 className="h-3.5 w-3.5" /> Dismiss
            </button>
            <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
              Clear selection
            </button>
          </div>
        )}

        {/* List */}
        {isLoading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : items.length === 0 ? (
          <div className="luxe-card rounded-xl p-10 flex flex-col items-center text-center gap-2 text-muted-foreground">
            <Bell className="h-6 w-6 text-muted-foreground/40" />
            <div className="text-sm">No notifications match this view.</div>
          </div>
        ) : (
          <div className="luxe-card rounded-xl overflow-hidden">
            <div className="px-4 py-2 border-b border-border bg-secondary/30 flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-gold"
                checked={selected.size === items.length && items.length > 0}
                onChange={toggleAll}
              />
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Select all ({items.length})
              </span>
            </div>
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <NotificationRow
                  key={n.id}
                  n={n}
                  selected={selected.has(n.id)}
                  onToggle={() => toggleSelect(n.id)}
                  onRead={() => readOne.mutate(n.id)}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

function NotificationRow({
  n, selected, onToggle, onRead,
}: {
  n: NotificationRow;
  selected: boolean;
  onToggle: () => void;
  onRead: () => void;
}) {
  const href = notificationHref(n);
  const isUnread = n.status === "unread";
  const priorityDot =
    n.priority === "urgent" ? "bg-red-500" :
    n.priority === "high" ? "bg-amber-500" :
    n.priority === "low" ? "bg-muted-foreground/40" : "bg-gold";

  const inner = (
    <div className={cn(
      "flex gap-3 px-4 py-3 hover:bg-muted/40 transition",
      isUnread && "bg-muted/20",
    )}>
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 accent-gold flex-shrink-0"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
      />
      <span className={cn("mt-1.5 h-2 w-2 rounded-full flex-shrink-0", priorityDot)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className={cn("text-sm font-medium", isUnread ? "text-foreground" : "text-muted-foreground")}>
            {n.title}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{n.type}</span>
            <span className="text-[10px] text-muted-foreground">
              {new Date(n.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
            </span>
          </div>
        </div>
        <div className="text-xs text-muted-foreground whitespace-pre-line mt-0.5 line-clamp-3">
          {n.body}
        </div>
        {isUnread && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRead(); }}
            className="mt-1.5 text-[10px] text-gold hover:underline inline-flex items-center gap-1"
          >
            <Check className="h-3 w-3" /> Mark read
          </button>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <li>
        <Link to={href} onClick={() => { if (isUnread) onRead(); }} className="block">
          {inner}
        </Link>
      </li>
    );
  }
  return <li>{inner}</li>;
}
