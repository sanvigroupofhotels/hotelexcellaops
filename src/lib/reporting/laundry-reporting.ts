/**
 * Laundry reporting — pure aggregation over `laundry_batches`,
 * `laundry_batch_lines`, and `laundry_queue`.
 *
 * Uses the same operational data the Laundry write-path already maintains
 * (Ship 1 + Ship 2). No duplicate business logic: this module is a read-only
 * rollup that the Monthly Billing module will later plug into.
 */
import { supabase } from "@/integrations/supabase/client";
import type { LaundryBatchRow, LaundryBatchLineRow } from "@/lib/laundry-batches-api";
import type { LaundryQueueRow } from "@/lib/laundry-queue-api";

export interface LaundryDailySummary {
  linenSent: number;         // sum qty_sent across batches sent in range
  linenReturned: number;     // sum qty_returned_ok across batches returned in range
  inHouseWashed: number;     // laundry_queue with processing_method='in_house' returned in range
  previousMissing: number;   // queued rows whose business_date < range.from (current backlog)
  outstandingWithVendor: number; // sum(sent − returned_ok − damaged − lost) for batches state='sent'
  damaged: number;           // sum qty_damaged across batches returned in range
  lost: number;              // sum qty_lost across batches returned in range
  totalBatches: number;      // batches sent in range
}

export interface LaundryVendorRow {
  vendorId: string;
  vendorName: string;
  totalBatches: number;
  linenSent: number;
  linenReturned: number;
  outstanding: number;
  damaged: number;
  lost: number;
  avgTurnaroundSecs: number | null;
}

export interface BatchWithLines extends LaundryBatchRow {
  lines: LaundryBatchLineRow[];
}

/** Fetch every batch whose sent_at OR returned_at falls in [from,to]. */
export async function fetchLaundryBatchesInRange(from: string, to: string): Promise<BatchWithLines[]> {
  // Use business_date on the batch as the operational anchor (matches how the
  // Laundry module presents dates). Also include in-flight batches so
  // "Outstanding" and "Previous Missing" totals stay accurate.
  const { data: batches, error } = await supabase
    .from("laundry_batches" as any)
    .select("*")
    .or(`and(business_date.gte.${from},business_date.lte.${to}),state.eq.sent`)
    .order("sent_at", { ascending: false });
  if (error) throw error;
  const rows = (batches ?? []) as unknown as LaundryBatchRow[];
  if (rows.length === 0) return [];
  const ids = rows.map((b) => b.id);
  const { data: lines, error: lErr } = await supabase
    .from("laundry_batch_lines" as any)
    .select("*")
    .in("batch_id", ids);
  if (lErr) throw lErr;
  const byBatch = new Map<string, LaundryBatchLineRow[]>();
  for (const l of (lines ?? []) as unknown as LaundryBatchLineRow[]) {
    const arr = byBatch.get(l.batch_id) ?? [];
    arr.push(l);
    byBatch.set(l.batch_id, arr);
  }
  return rows.map((b) => ({ ...b, lines: byBatch.get(b.id) ?? [] }));
}

export async function fetchLaundryQueueBefore(from: string): Promise<LaundryQueueRow[]> {
  const { data, error } = await supabase
    .from("laundry_queue" as any)
    .select("*")
    .eq("state", "queued")
    .lt("business_date", from);
  if (error) throw error;
  return (data ?? []) as unknown as LaundryQueueRow[];
}

/** In-house washed = queue rows moved to `returned` with processing_method='in_house' whose business_date is in range. */
export async function fetchInHouseReturnedInRange(from: string, to: string): Promise<number> {
  const { data, error } = await supabase
    .from("laundry_queue" as any)
    .select("qty")
    .eq("state", "returned")
    .eq("processing_method", "in_house")
    .gte("business_date", from)
    .lte("business_date", to);
  if (error) throw error;
  return ((data ?? []) as any[]).reduce((s, r) => s + (Number(r.qty) || 0), 0);
}

function sumLines(lines: LaundryBatchLineRow[], key: keyof LaundryBatchLineRow): number {
  return lines.reduce((s, l) => s + (Number(l[key] as any) || 0), 0);
}

export function computeLaundryDailySummary(input: {
  batches: BatchWithLines[];
  from: string;
  to: string;
  inHouseWashed: number;
  previousMissing: number;
}): LaundryDailySummary {
  const { batches, from, to, inHouseWashed, previousMissing } = input;
  let linenSent = 0, linenReturned = 0, damaged = 0, lost = 0, outstandingWithVendor = 0, totalBatches = 0;

  for (const b of batches) {
    const sentInRange = b.sent_at && b.business_date >= from && b.business_date <= to;
    if (sentInRange && b.state !== "cancelled") {
      totalBatches += 1;
      linenSent += sumLines(b.lines, "qty_sent");
    }
    const returnedInRange = b.state === "returned" && b.returned_at
      && b.returned_at.slice(0, 10) >= from && b.returned_at.slice(0, 10) <= to;
    if (returnedInRange) {
      linenReturned += sumLines(b.lines, "qty_returned_ok");
      damaged += sumLines(b.lines, "qty_damaged");
      lost += sumLines(b.lines, "qty_lost");
    }
    if (b.state === "sent") {
      outstandingWithVendor += sumLines(b.lines, "qty_sent");
    }
  }

  return {
    linenSent, linenReturned, inHouseWashed, previousMissing,
    outstandingWithVendor, damaged, lost, totalBatches,
  };
}

export function computeLaundryVendorSummary(batches: BatchWithLines[], from: string, to: string): LaundryVendorRow[] {
  const byVendor = new Map<string, LaundryVendorRow & { _turnarounds: number[] }>();
  for (const b of batches) {
    if (b.state === "cancelled") continue;
    const key = b.vendor_id;
    let v = byVendor.get(key);
    if (!v) {
      v = {
        vendorId: b.vendor_id,
        vendorName: b.vendor_name_at_time,
        totalBatches: 0, linenSent: 0, linenReturned: 0,
        outstanding: 0, damaged: 0, lost: 0,
        avgTurnaroundSecs: null,
        _turnarounds: [],
      };
      byVendor.set(key, v);
    }
    const sentInRange = b.sent_at && b.business_date >= from && b.business_date <= to;
    if (sentInRange) {
      v.totalBatches += 1;
      v.linenSent += sumLines(b.lines, "qty_sent");
    }
    if (b.state === "sent") {
      v.outstanding += sumLines(b.lines, "qty_sent");
    }
    if (b.state === "returned" && b.returned_at) {
      const returnedInRange = b.returned_at.slice(0, 10) >= from && b.returned_at.slice(0, 10) <= to;
      if (returnedInRange) {
        v.linenReturned += sumLines(b.lines, "qty_returned_ok");
        v.damaged += sumLines(b.lines, "qty_damaged");
        v.lost += sumLines(b.lines, "qty_lost");
        const s = new Date(b.sent_at).getTime();
        const r = new Date(b.returned_at).getTime();
        if (Number.isFinite(s) && Number.isFinite(r) && r > s) {
          v._turnarounds.push(Math.floor((r - s) / 1000));
        }
      }
    }
  }
  return Array.from(byVendor.values())
    .map(({ _turnarounds, ...rest }) => ({
      ...rest,
      avgTurnaroundSecs: _turnarounds.length ? Math.floor(_turnarounds.reduce((a, b) => a + b, 0) / _turnarounds.length) : null,
    }))
    .sort((a, b) => b.totalBatches - a.totalBatches);
}

export function sumPreviousMissing(queue: LaundryQueueRow[]): number {
  return queue.reduce((s, r) => s + (Number(r.qty) || 0), 0);
}
