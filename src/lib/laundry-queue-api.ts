/**
 * Laundry queue — insert-on-linen-change.
 *
 * Every linen line on a completed housekeeping task creates one row in
 * `laundry_queue` (see design §4.2). Linen never touches inventory (C10);
 * the future Laundry module owns lifecycle from `queued` → `sent` → `returned`.
 */
import { supabase } from "@/integrations/supabase/client";

export interface LaundryQueueRow {
  id: string;
  room_id: string;
  booking_id: string | null;
  linen_type_id: string;
  linen_name_at_time: string | null;
  qty: number;
  source_task_id: string | null;
  state: "queued" | "sent" | "returned" | "written_off";
  batch_id?: string | null;
  processing_method?: "vendor" | "in_house" | null;
  business_date: string;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueueLinenInput {
  room_id: string;
  booking_id?: string | null;
  linen_type_id: string;
  linen_name_at_time: string;
  qty: number;
  source_task_id: string;
  business_date: string;
  actor_id?: string | null;
  actor_name?: string | null;
}

export async function enqueueLinen(lines: QueueLinenInput[]): Promise<void> {
  const rows = lines
    .filter((l) => l.qty > 0)
    .map((l) => ({
      room_id: l.room_id,
      booking_id: l.booking_id ?? null,
      linen_type_id: l.linen_type_id,
      linen_name_at_time: l.linen_name_at_time,
      qty: Math.floor(l.qty),
      source_task_id: l.source_task_id,
      business_date: l.business_date,
      state: "queued" as const,
      actor_id: l.actor_id ?? null,
      actor_name: l.actor_name ?? null,
    }));
  if (rows.length === 0) return;
  const { error } = await supabase.from("laundry_queue" as any).insert(rows as any);
  if (error) throw error;
}

export async function listLaundryQueue(state?: LaundryQueueRow["state"]) {
  let q = supabase.from("laundry_queue" as any).select("*").order("created_at", { ascending: false });
  if (state) q = q.eq("state", state);
  const { data, error } = await q.limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as LaundryQueueRow[];
}
