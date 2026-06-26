/**
 * Notification Routing — single source of truth.
 *
 * Every surface that opens a notification (in-app bell, Service Worker
 * click handler, Push dispatcher payload, BroadcastChannel mirrors,
 * future channels) MUST call `resolveNotificationRoute()` so the user
 * always lands on the most actionable destination.
 *
 * Preferred routing order (per product spec):
 *   1. Booking          → /bookings/:id
 *   2. Draft Booking    → /bookings/:id/edit
 *   3. Customer Profile → /customers/:id
 *   4. Follow-ups       → /follow-ups   (final fallback only)
 *
 * Specialized entity types (complaint, payment, review, night_audit)
 * are honoured first because they are themselves highly actionable.
 */
export interface NotificationLike {
  entity_type?: string | null;
  entity_id?: string | null;
  metadata?: Record<string, any> | null;
}

const NULLISH = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

export function resolveNotificationRoute(n: NotificationLike): string {
  const m = (n.metadata ?? {}) as Record<string, any>;

  // 1. Booking — direct entity OR metadata reference
  if (n.entity_type === "booking" && NULLISH(n.entity_id)) {
    return `/bookings/${n.entity_id}`;
  }
  if (NULLISH(m.booking_id)) {
    return `/bookings/${m.booking_id}`;
  }

  // 2. Draft Booking
  if (NULLISH(m.draft_booking_id)) {
    return `/bookings/${m.draft_booking_id}/edit`;
  }

  // 3. Specialised entity types
  switch (n.entity_type) {
    case "customer":
      if (NULLISH(n.entity_id)) return `/customers/${n.entity_id}`;
      break;
    case "complaint":
      if (NULLISH(n.entity_id)) return `/complaints/${n.entity_id}`;
      break;
    case "payment":
      return "/reporting/payments";
    case "review":
      return "/reporting/crm-analytics";
    case "night_audit":
      return "/night-audit";
  }

  // 4. Customer profile via metadata (e.g. abandoned lead with customer)
  if (NULLISH(m.customer_id)) {
    return `/customers/${m.customer_id}`;
  }

  // 5. Final fallback — Follow-ups workspace
  return "/follow-ups";
}
