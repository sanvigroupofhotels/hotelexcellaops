import { supabase } from "@/integrations/supabase/client";
import { resolveNotificationRoute } from "@/lib/notification-routing";

export type NotificationStatus = "unread" | "read" | "dismissed";
export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_reference: string | null;
  priority: NotificationPriority;
  status: NotificationStatus;
  audience_role: string | null;
  user_id: string | null;
  metadata: Record<string, any>;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function listNotifications(limit = 50): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications" as any)
    .select("*")
    .neq("status", "dismissed")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as any;
}

export async function unreadNotificationCount(): Promise<number> {
  const { count, error } = await supabase
    .from("notifications" as any)
    .select("id", { count: "exact", head: true })
    .eq("status", "unread");
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from("notifications" as any)
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase
    .from("notifications" as any)
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("status", "unread");
  if (error) throw error;
}

export async function deleteNotification(id: string): Promise<void> {
  // Soft-dismiss so we keep an audit trail in the underlying table.
  const { error } = await supabase
    .from("notifications" as any)
    .update({ status: "dismissed" })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Bulk dismiss every non-dismissed notification the caller can see.
 * Used by the Notification Center "Dismiss All" action; when filters are
 * applied on the Notifications workspace, the caller should pass a list of
 * filtered IDs to `dismissNotifications` instead.
 */
export async function dismissAllVisibleNotifications(): Promise<void> {
  const { error } = await supabase
    .from("notifications" as any)
    .update({ status: "dismissed" })
    .neq("status", "dismissed");
  if (error) throw error;
}

export async function dismissNotifications(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase
    .from("notifications" as any)
    .update({ status: "dismissed" })
    .in("id", ids);
  if (error) throw error;
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase
    .from("notifications" as any)
    .update({ status: "read", read_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw error;
}

export async function listAllNotifications(opts: {
  status?: "unread" | "read" | "dismissed" | "active";
  type?: string;
  search?: string;
  limit?: number;
} = {}): Promise<NotificationRow[]> {
  let q = supabase.from("notifications" as any).select("*").order("created_at", { ascending: false });
  if (opts.status === "active") q = q.neq("status", "dismissed");
  else if (opts.status) q = q.eq("status", opts.status);
  if (opts.type) q = q.eq("type", opts.type);
  if (opts.search?.trim()) {
    const s = `%${opts.search.trim()}%`;
    q = q.or(`title.ilike.${s},body.ilike.${s},entity_reference.ilike.${s}`);
  }
  q = q.limit(opts.limit ?? 200);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as any;
}

/**
 * Single-source-of-truth router for every notification surface.
 * Delegates to `resolveNotificationRoute` (see `src/lib/notification-routing.ts`)
 * so the in-app bell, service worker click handler, and push payload all
 * resolve identical destinations.
 */
export function notificationHref(n: NotificationRow): string | null {
  return resolveNotificationRoute(n);
}
