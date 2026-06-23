/**
 * Centralised activity logger.
 *
 * Single thin wrapper over the `log_activity` Postgres RPC. Every cross-cutting
 * event (auth, bookings, stay, payments, night audit, customers, users) MUST
 * flow through this helper so the vocabulary, source whitelist and
 * correlation-id semantics stay consistent across the codebase.
 *
 * Failures NEVER throw — instrumentation must not break the business action.
 */

import { supabase } from "@/integrations/supabase/client";

export type ActivitySource =
  | "manual"
  | "house_view"
  | "guest_portal"
  | "ota"
  | "night_audit"
  | "system"
  | "api";

/** Event vocabulary (past tense, snake_case). Keep in sync with the activity dashboard quick-pick. */
export type ActivityAction =
  // Auth
  | "user_logged_in"
  | "user_logged_out"
  // Bookings
  | "booking_created"
  | "booking_updated"
  | "booking_moved"
  | "booking_cancelled"
  | "booking_no_show"
  // Stay
  | "guest_checked_in"
  | "guest_checked_out"
  | "guest_check_in_reverted"
  | "guest_check_out_reverted"
  // Payments
  | "payment_recorded"
  | "payment_refunded"
  | "payment_written_off"
  // Night Audit
  | "night_audit_started"
  | "night_audit_completed"
  | "night_audit_reopened"
  // Customers
  | "customer_created"
  | "customer_updated"
  | "customer_merged"
  | "customer_documents_uploaded"
  // Users / Access
  | "user_created"
  | "user_role_changed"
  | "user_permission_granted"
  | "user_permission_revoked"
  | "user_disabled"
  | "user_enabled"
  | (string & {});

export interface LogActivityInput {
  page: string;
  action: ActivityAction;
  entity_type?: string | null;
  entity_id?: string | null;
  entity_reference?: string | null;
  summary?: string | null;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
  metadata?: Record<string, any> | null;
  source?: ActivitySource;
  property_id?: string | null;
  /** Group several events that belong to the same business transaction. */
  correlation_id?: string | null;
}

export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await supabase.rpc("log_activity" as any, {
      p_page: input.page,
      p_action: input.action,
      p_entity_type: input.entity_type ?? null,
      p_entity_id: input.entity_id ?? null,
      p_entity_reference: input.entity_reference ?? null,
      p_summary: input.summary ?? null,
      p_before: (input.before ?? null) as any,
      p_after: (input.after ?? null) as any,
      p_metadata: (input.metadata ?? null) as any,
      p_source: input.source ?? "manual",
      p_property_id: input.property_id ?? null,
      p_correlation_id: input.correlation_id ?? null,
    } as any);
  } catch {
    /* swallow — instrumentation must never break the business path */
  }
}

/** Convenience: stable UUID for grouping events in one transaction. */
export function newCorrelationId(): string {
  // crypto.randomUUID is available in modern browsers and the Workers runtime.
  return (globalThis as any).crypto?.randomUUID?.() ??
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}
