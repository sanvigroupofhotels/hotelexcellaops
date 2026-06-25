import { supabase } from "@/integrations/supabase/client";

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

/** Route a notification to its source entity. */
export function notificationHref(n: NotificationRow): string | null {
  if (!n.entity_type || !n.entity_id) return null;
  switch (n.entity_type) {
    case "booking": return `/bookings/${n.entity_id}`;
    case "lead":    return `/follow-ups`;
    case "customer":return `/customers/${n.entity_id}`;
    case "complaint": return `/complaints/${n.entity_id}`;
    case "payment": return `/reporting/payments`;
    case "review":  return `/reporting/crm-analytics`;
    case "night_audit": return `/night-audit`;
    default: return null;
  }
}
