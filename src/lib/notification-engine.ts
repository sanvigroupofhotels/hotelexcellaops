/**
 * Notification Engine — single fan-out for in-app + push + email.
 *
 * Architecture
 * ────────────
 * 1. Caller invokes `emitNotification(event)`.
 * 2. Engine inserts one row into `public.notifications`.
 * 3. Database triggers fan out:
 *      • `notifications_dispatch_push_trg`  → /api/public/push-dispatch (Web Push)
 *      • `notifications_dispatch_email_trg` → /api/public/notification-email-dispatch (Resend)
 *    Both are best-effort and never block the in-app delivery.
 *
 * Adding a new notification type is a one-liner: declare it in
 * `NotificationEventType`, build the payload, and call `emitNotification`.
 * No new tables, routes, or triggers are required.
 */
import { supabase } from "@/integrations/supabase/client";

export type NotificationEventType =
  | "lead_abandoned"
  | "booking_created"
  | "booking_cancelled"
  | "payment_received"
  | "complaint_created"
  | "review_received"
  | "test";

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export interface NotificationEvent {
  type: NotificationEventType;
  title: string;
  body: string;
  entity_type?: string | null;
  entity_id?: string | null;
  entity_reference?: string | null;
  priority?: NotificationPriority;
  audience_role?: string | null;
  user_id?: string | null;
  metadata?: Record<string, any> | null;
}

/**
 * Insert one notification row. Push + email fan-out happen via DB triggers,
 * so callers don't need to know which channels are enabled.
 *
 * NEVER throws — operational events must not break the primary user action.
 * Errors are logged and swallowed.
 */
export async function emitNotification(event: NotificationEvent): Promise<void> {
  try {
    const row = {
      type: event.type,
      title: event.title,
      body: event.body,
      entity_type: event.entity_type ?? null,
      entity_id: event.entity_id ?? null,
      entity_reference: event.entity_reference ?? null,
      priority: event.priority ?? "normal",
      audience_role: event.audience_role ?? "operations",
      user_id: event.user_id ?? null,
      status: "unread",
      metadata: event.metadata ?? {},
    };
    const { error } = await supabase.from("notifications" as any).insert(row as any);
    if (error) console.warn("[notification-engine] insert failed:", error.message);
  } catch (e: any) {
    console.warn("[notification-engine] emit error:", e?.message ?? e);
  }
}

// ─── Convenience builders (one per event type) ────────────────────────────

export function emitBookingCreated(b: {
  id: string;
  booking_reference?: string | null;
  guest_name?: string | null;
  phone?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  rooms?: number | null;
  estimated_total?: number | null;
  source?: string | null;
}) {
  const body = [
    `Guest: ${b.guest_name ?? "—"}`,
    `Phone: ${b.phone ?? "—"}`,
    `Check-In: ${b.check_in ?? "—"}`,
    `Check-Out: ${b.check_out ?? "—"}`,
    b.rooms ? `Rooms: ${b.rooms}` : null,
    b.estimated_total ? `Value: ₹${b.estimated_total}` : null,
    b.source ? `Source: ${b.source}` : null,
  ].filter(Boolean).join("\n");
  return emitNotification({
    type: "booking_created",
    title: "New Booking Created",
    body,
    entity_type: "booking",
    entity_id: b.id,
    entity_reference: b.booking_reference ?? null,
    priority: "normal",
    metadata: { booking_id: b.id, source: b.source ?? null },
  });
}

export function emitBookingCancelled(b: {
  id: string;
  booking_reference?: string | null;
  guest_name?: string | null;
  reason?: string | null;
}) {
  return emitNotification({
    type: "booking_cancelled",
    title: "Booking Cancelled",
    body: `${b.guest_name ?? "Guest"} · ${b.booking_reference ?? b.id}${b.reason ? `\nReason: ${b.reason}` : ""}`,
    entity_type: "booking",
    entity_id: b.id,
    entity_reference: b.booking_reference ?? null,
    priority: "high",
    metadata: { booking_id: b.id, reason: b.reason ?? null },
  });
}

export function emitPaymentReceived(p: {
  payment_id: string;
  booking_id: string;
  booking_reference?: string | null;
  amount: number;
  payment_mode: string;
  collected_by: string;
  is_refund?: boolean;
}) {
  const verb = p.is_refund ? "Refund" : "Payment";
  return emitNotification({
    type: "payment_received",
    title: `${verb} Recorded`,
    body: `₹${p.amount} · ${p.payment_mode} · by ${p.collected_by}${p.booking_reference ? `\nBooking: ${p.booking_reference}` : ""}`,
    entity_type: "booking",
    entity_id: p.booking_id,
    entity_reference: p.booking_reference ?? null,
    priority: "normal",
    metadata: {
      booking_id: p.booking_id,
      payment_id: p.payment_id,
      amount: p.amount,
      payment_mode: p.payment_mode,
      is_refund: !!p.is_refund,
    },
  });
}

export function emitComplaintCreated(c: {
  id: string;
  complaint_number?: string | null;
  priority: string;
  description: string;
  room_number?: string | null;
  category?: string | null;
}) {
  return emitNotification({
    type: "complaint_created",
    title: `New Complaint (${c.priority})`,
    body: [
      c.complaint_number ? `Ref: ${c.complaint_number}` : null,
      c.room_number ? `Room: ${c.room_number}` : null,
      c.category ? `Category: ${c.category}` : null,
      c.description.slice(0, 240),
    ].filter(Boolean).join("\n"),
    entity_type: "complaint",
    entity_id: c.id,
    entity_reference: c.complaint_number ?? null,
    priority: c.priority === "Critical" ? "urgent" : c.priority === "High" ? "high" : "normal",
    metadata: { complaint_id: c.id },
  });
}

export function emitReviewReceived(r: {
  booking_id: string;
  rating: number;
  guest_name?: string | null;
  comment?: string | null;
  routed_to_external?: boolean;
}) {
  return emitNotification({
    type: "review_received",
    title: `New Guest Review · ${"★".repeat(Math.max(1, Math.min(5, r.rating)))}`,
    body: [
      `Guest: ${r.guest_name ?? "—"}`,
      `Rating: ${r.rating}/5`,
      r.comment ? `Comment: ${r.comment.slice(0, 240)}` : null,
      r.routed_to_external ? "Guest invited to Google review." : null,
    ].filter(Boolean).join("\n"),
    entity_type: "review",
    entity_id: null,
    entity_reference: String(r.rating),
    priority: r.rating <= 2 ? "high" : "normal",
    metadata: { booking_id: r.booking_id, rating: r.rating },
  });
}
