import { supabase } from "@/integrations/supabase/client";

export type InventoryMovementReason =
  | "stock_in"
  | "stock_out"
  | "auto_charge"
  | "auto_housekeeping"
  | "reconciliation_adjust"
  | "wastage"
  | "correction";

export interface InventoryMovementRow {
  id: string;
  item_id: string;
  delta: number;
  reason: InventoryMovementReason;
  source_type: string | null;
  source_id: string | null;
  unit_cost: number | null;
  vendor_id: string | null;
  notes: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  batch_id: string | null;
  correlation_id: string | null;
  occurred_at: string;
  created_at: string;
}

export interface RecordMovementInput {
  item_id: string;
  delta: number;                          // signed
  reason: InventoryMovementReason;
  source_type?: string | null;
  source_id?: string | null;
  unit_cost?: number | null;
  vendor_id?: string | null;
  notes?: string | null;
  batch_id?: string | null;
  correlation_id?: string | null;
  occurred_at?: string;
}

/**
 * Single write path for all inventory stock changes. UI must call this — no
 * direct table inserts. Trigger keeps `inventory_items.current_stock` in sync.
 */
export async function recordMovement(input: RecordMovementInput): Promise<InventoryMovementRow> {
  if (!input.item_id) throw new Error("item_id required");
  if (!Number.isFinite(input.delta) || input.delta === 0) {
    throw new Error("delta must be a non-zero number");
  }
  const { data: u } = await supabase.auth.getUser();
  const row: any = {
    item_id: input.item_id,
    delta: Number(input.delta),
    reason: input.reason,
    source_type: input.source_type ?? null,
    source_id: input.source_id ?? null,
    unit_cost: input.unit_cost ?? null,
    vendor_id: input.vendor_id ?? null,
    notes: input.notes?.trim() || null,
    batch_id: input.batch_id ?? null,
    correlation_id: input.correlation_id ?? null,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    user_id: u?.user?.id ?? null,
  };
  const { data, error } = await supabase.from("inventory_movements" as any).insert(row).select().single();
  if (error) throw error;
  return data as any;
}

export async function stockIn(input: {
  item_id: string; quantity: number; unit_cost?: number | null;
  vendor_id?: string | null; notes?: string | null;
}): Promise<InventoryMovementRow> {
  if (!(input.quantity > 0)) throw new Error("Quantity must be greater than zero");
  return recordMovement({
    item_id: input.item_id,
    delta: input.quantity,
    reason: "stock_in",
    unit_cost: input.unit_cost ?? null,
    vendor_id: input.vendor_id ?? null,
    notes: input.notes ?? null,
  });
}

export async function stockOut(input: {
  item_id: string; quantity: number; reason?: "stock_out" | "wastage"; notes?: string | null;
}): Promise<InventoryMovementRow> {
  if (!(input.quantity > 0)) throw new Error("Quantity must be greater than zero");
  return recordMovement({
    item_id: input.item_id,
    delta: -Math.abs(input.quantity),
    reason: input.reason ?? "stock_out",
    notes: input.notes ?? null,
  });
}

export async function listMovements(opts?: {
  item_id?: string; limit?: number;
}): Promise<InventoryMovementRow[]> {
  let q = supabase.from("inventory_movements" as any).select("*").order("occurred_at", { ascending: false });
  if (opts?.item_id) q = q.eq("item_id", opts.item_id);
  q = q.limit(opts?.limit ?? 200);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as any;
}

export function formatReason(r: InventoryMovementReason): string {
  switch (r) {
    case "stock_in": return "Stock In";
    case "stock_out": return "Stock Out";
    case "auto_charge": return "Auto (Charge)";
    case "auto_housekeeping": return "Auto (Housekeeping)";
    case "reconciliation_adjust": return "Reconciliation";
    case "wastage": return "Wastage";
    case "correction": return "Correction";
  }
}
