/**
 * Laundry Batches — Phase 3B Ship 1 (send path).
 *
 * A batch represents one physical pickup by a laundry vendor. The HEOS
 * queue count is a suggestion; the *sent* count is edited during physical
 * counting with the vendor and becomes authoritative. In-house wash is
 * the residual (`heos_queue − sent`) and is never a user input.
 *
 * Queue rows flip terminal states rather than parking in a "washed_in_house"
 * state (per operational feedback): the queue stays a pure pending-work
 * signal, and `processing_method` records how each row was handled.
 */
import { supabase } from "@/integrations/supabase/client";
import { logActivity, newCorrelationId } from "@/lib/activity-log";

const SLIP_BUCKET = "laundry-slips";

export type LaundryBatchState = "sent" | "returned" | "cancelled";

export interface LaundryBatchRow {
  id: string;
  batch_number: string;
  vendor_id: string;
  vendor_name_at_time: string;
  state: LaundryBatchState;
  business_date: string;
  vendor_slip_number: string | null;
  pickup_slip_photo_path: string | null;
  return_photo_path: string | null;
  pickup_remarks: string | null;
  return_remarks: string | null;
  sent_at: string;
  sent_by_user_id: string | null;
  sent_by_name: string | null;
  returned_at: string | null;
  returned_by_user_id: string | null;
  returned_by_name: string | null;
  cancelled_at: string | null;
  cancelled_by_user_id: string | null;
  cancelled_by_name: string | null;
  correlation_id: string;
  invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LaundryBatchLineRow {
  id: string;
  batch_id: string;
  linen_type_id: string;
  linen_name_at_time: string;
  qty_heos_queue: number;
  qty_sent: number;
  qty_returned_ok: number;
  qty_short: number;
  qty_damaged: number;
  qty_lost: number;
  qty_in_house: number;
  created_at: string;
  updated_at: string;
}

/** Per linen-type snapshot of the current queue plus previously-missing rollover. */
export interface PickupPreviewRow {
  linen_type_id: string;
  linen_name: string;
  heos_queue: number;    // total queued rows for this linen type
  prev_missing: number;  // queued rows that were queued *before* today (short-return rollover)
  sort_order: number;
}

/** Aggregate the queue for the pickup screen. */
export async function previewPickup(businessDate: string): Promise<{
  rows: PickupPreviewRow[];
  oldestDays: number | null;   // days since oldest queued business_date
}> {
  const { data: queued, error: qErr } = await supabase
    .from("laundry_queue" as any)
    .select("linen_type_id, linen_name_at_time, qty, business_date, created_at")
    .eq("state", "queued");
  if (qErr) throw qErr;

  const { data: linenTypes, error: lErr } = await supabase
    .from("linen_types" as any)
    .select("id, name, sort_order, active")
    .eq("active", true)
    .order("sort_order");
  if (lErr) throw lErr;

  const byType = new Map<string, PickupPreviewRow>();
  for (const lt of (linenTypes ?? []) as any[]) {
    byType.set(lt.id, {
      linen_type_id: lt.id,
      linen_name: lt.name,
      heos_queue: 0,
      prev_missing: 0,
      sort_order: lt.sort_order ?? 0,
    });
  }
  let oldest: string | null = null;
  for (const r of (queued ?? []) as any[]) {
    const row = byType.get(r.linen_type_id);
    if (!row) continue;
    row.heos_queue += Number(r.qty ?? 0);
    if (r.business_date < businessDate) row.prev_missing += Number(r.qty ?? 0);
    if (!oldest || r.business_date < oldest) oldest = r.business_date;
  }
  const rows = Array.from(byType.values()).sort((a, b) => a.sort_order - b.sort_order || a.linen_name.localeCompare(b.linen_name));
  let oldestDays: number | null = null;
  if (oldest) {
    const today = new Date(businessDate + "T00:00:00");
    const then = new Date(oldest + "T00:00:00");
    oldestDays = Math.floor((today.getTime() - then.getTime()) / 86_400_000);
  }
  return { rows, oldestDays };
}

export interface CreateBatchInput {
  vendor_id: string;
  vendor_name_at_time: string;
  business_date: string;
  vendor_slip_number?: string | null;
  pickup_remarks?: string | null;
  lines: Array<{
    linen_type_id: string;
    linen_name_at_time: string;
    qty_heos_queue: number;
    qty_sent: number;
  }>;
  performer: { id: string; name: string };
  slipPhotoFile?: File | null;
}

/**
 * Create a batch and flip the underlying queue rows:
 *   - N oldest queued rows per linen type where N = qty_sent → state='sent', batch_id, processing_method='vendor'
 *   - remainder (qty_heos_queue − qty_sent) → state='returned', processing_method='in_house'
 *
 * The whole thing is best-effort atomic from the client. On failure after
 * batch insert we don't rollback (edge cases would need a server fn); we
 * surface the error and log for operational review.
 */
export async function createBatch(input: CreateBatchInput): Promise<LaundryBatchRow> {
  if (!input.vendor_id) throw new Error("Vendor is required");
  const activeLines = input.lines.filter(
    (l) => l.qty_heos_queue > 0 || l.qty_sent > 0,
  );
  if (activeLines.length === 0) throw new Error("Nothing to send — the queue is empty");
  for (const l of activeLines) {
    if (l.qty_sent < 0) throw new Error("Sent quantity cannot be negative");
    if (l.qty_sent > l.qty_heos_queue) {
      throw new Error(
        `Sent (${l.qty_sent}) cannot exceed HEOS queue (${l.qty_heos_queue}) for ${l.linen_name_at_time}`,
      );
    }
  }

  const correlationId = newCorrelationId();

  const { data: batch, error: bErr } = await supabase
    .from("laundry_batches" as any)
    .insert({
      vendor_id: input.vendor_id,
      vendor_name_at_time: input.vendor_name_at_time,
      state: "sent",
      business_date: input.business_date,
      vendor_slip_number: input.vendor_slip_number?.trim() || null,
      pickup_remarks: input.pickup_remarks?.trim() || null,
      sent_by_user_id: input.performer.id,
      sent_by_name: input.performer.name,
      correlation_id: correlationId,
    })
    .select()
    .single();
  if (bErr) throw bErr;
  const batchRow = batch as unknown as LaundryBatchRow;

  // Optional slip photo
  if (input.slipPhotoFile) {
    try {
      const path = await uploadLaundryPhoto(batchRow.id, "pickup", input.slipPhotoFile);
      await supabase.from("laundry_batches" as any).update({ pickup_slip_photo_path: path }).eq("id", batchRow.id);
      batchRow.pickup_slip_photo_path = path;
    } catch (e) {
      console.error("Pickup slip photo upload failed", e);
    }
  }

  // Insert lines
  const lineRows = activeLines.map((l) => ({
    batch_id: batchRow.id,
    linen_type_id: l.linen_type_id,
    linen_name_at_time: l.linen_name_at_time,
    qty_heos_queue: Math.floor(l.qty_heos_queue),
    qty_sent: Math.floor(l.qty_sent),
  }));
  const { error: lErr } = await supabase.from("laundry_batch_lines" as any).insert(lineRows);
  if (lErr) throw lErr;

  // Flip queue rows per linen type — oldest first.
  for (const l of activeLines) {
    const { data: rows, error: rErr } = await supabase
      .from("laundry_queue" as any)
      .select("id, qty")
      .eq("state", "queued")
      .eq("linen_type_id", l.linen_type_id)
      .order("business_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (rErr) throw rErr;
    let needSent = Math.floor(l.qty_sent);
    let needInHouse = Math.floor(l.qty_heos_queue - l.qty_sent);
    const sentIds: string[] = [];
    const inHouseIds: string[] = [];
    for (const r of ((rows ?? []) as any[])) {
      // qty on each row is typically 1 (HK generator inserts one row per linen line),
      // but we treat the number defensively — allocate whole rows greedily.
      const q = Number(r.qty ?? 1);
      if (needSent >= q) { sentIds.push(r.id); needSent -= q; continue; }
      if (needInHouse >= q) { inHouseIds.push(r.id); needInHouse -= q; continue; }
      break;
    }
    if (sentIds.length > 0) {
      await supabase.from("laundry_queue" as any).update({
        state: "sent",
        batch_id: batchRow.id,
        processing_method: "vendor",
      }).in("id", sentIds);
    }
    if (inHouseIds.length > 0) {
      await supabase.from("laundry_queue" as any).update({
        state: "returned",
        processing_method: "in_house",
      }).in("id", inHouseIds);
    }
  }

  const totalSent = activeLines.reduce((s, l) => s + l.qty_sent, 0);
  const totalInHouse = activeLines.reduce((s, l) => s + (l.qty_heos_queue - l.qty_sent), 0);
  const parts = activeLines
    .filter((l) => l.qty_sent > 0)
    .map((l) => `${l.qty_sent} ${l.linen_name_at_time}`)
    .join(", ");

  void logActivity({
    page: "laundry",
    action: "laundry_batch_sent",
    entity_type: "laundry_batch",
    entity_id: batchRow.id,
    entity_reference: batchRow.batch_number,
    summary: `Sent ${totalSent} pieces (${parts || "nothing"}) to ${input.vendor_name_at_time}${input.vendor_slip_number ? ` · slip #${input.vendor_slip_number}` : ""}`,
    metadata: {
      total_sent: totalSent,
      total_in_house: totalInHouse,
      vendor_id: input.vendor_id,
      lines: activeLines,
    },
    correlation_id: correlationId,
    source: "manual",
  });

  if (totalInHouse > 0) {
    void logActivity({
      page: "laundry",
      action: "laundry_in_house_recorded",
      entity_type: "laundry_batch",
      entity_id: batchRow.id,
      entity_reference: batchRow.batch_number,
      summary: `${totalInHouse} pieces washed in-house`,
      metadata: { total_in_house: totalInHouse },
      correlation_id: correlationId,
      source: "manual",
    });
  }

  return batchRow;
}

/** Cancel a batch that hasn't been returned yet — reverts queue rows to `queued`. */
export async function cancelBatch(batchId: string, performer: { id: string; name: string }): Promise<void> {
  const { data: batch, error: bErr } = await supabase
    .from("laundry_batches" as any).select("*").eq("id", batchId).single();
  if (bErr) throw bErr;
  const b = batch as unknown as LaundryBatchRow;
  if (b.state !== "sent") throw new Error("Only sent batches can be cancelled");

  // Return sent queue rows to queued state. In-house ones stay 'returned' (already washed).
  const { error: qErr } = await supabase
    .from("laundry_queue" as any)
    .update({ state: "queued", batch_id: null, processing_method: null })
    .eq("batch_id", batchId)
    .eq("processing_method", "vendor");
  if (qErr) throw qErr;

  const { error: uErr } = await supabase
    .from("laundry_batches" as any)
    .update({
      state: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by_user_id: performer.id,
      cancelled_by_name: performer.name,
    })
    .eq("id", batchId);
  if (uErr) throw uErr;

  void logActivity({
    page: "laundry",
    action: "laundry_batch_cancelled",
    entity_type: "laundry_batch",
    entity_id: batchId,
    entity_reference: b.batch_number,
    summary: `Cancelled batch ${b.batch_number}`,
    correlation_id: b.correlation_id,
    source: "manual",
  });
}

/* ─────────────────────────  Return path (Ship 2)  ───────────────────── */

export interface ConfirmReturnInput {
  batch_id: string;
  lines: Array<{
    line_id: string;
    linen_type_id: string;
    linen_name_at_time: string;
    qty_sent: number;
    qty_returned_ok: number;
    qty_short: number;
    qty_damaged: number;
    qty_lost: number;
  }>;
  return_remarks?: string | null;
  performer: { id: string; name: string };
  returnPhotoFile?: File | null;
}

/**
 * Confirm return of a batch. Validates ok+short+dmg+lost = qty_sent per line,
 * writes the return quantities on batch_lines, flips the batch to `returned`,
 * and reconciles the underlying queue rows:
 *   - OK        → state='returned' (final, remains linked to batch)
 *   - Short     → state='queued', batch_id=null, processing_method=null
 *                 (rolls forward — appears as "Previous Missing" next pickup)
 *   - Damaged   → state='written_off'
 *   - Lost      → state='written_off'
 */
export async function confirmReturn(input: ConfirmReturnInput): Promise<LaundryBatchRow> {
  const { data: batch, error: bErr } = await supabase
    .from("laundry_batches" as any).select("*").eq("id", input.batch_id).single();
  if (bErr) throw bErr;
  const b = batch as unknown as LaundryBatchRow;
  if (b.state !== "sent") throw new Error(`Batch is ${b.state} — cannot confirm return`);

  // Validate every line
  for (const l of input.lines) {
    const sum = l.qty_returned_ok + l.qty_short + l.qty_damaged + l.qty_lost;
    if (sum !== l.qty_sent) {
      throw new Error(
        `${l.linen_name_at_time}: OK+Short+Damaged+Lost (${sum}) must equal Sent (${l.qty_sent})`,
      );
    }
    if (l.qty_returned_ok < 0 || l.qty_short < 0 || l.qty_damaged < 0 || l.qty_lost < 0) {
      throw new Error("Quantities cannot be negative");
    }
  }

  // Optional return photo
  let returnPhotoPath: string | null = null;
  if (input.returnPhotoFile) {
    try {
      returnPhotoPath = await uploadLaundryPhoto(b.id, "return", input.returnPhotoFile);
    } catch (e) {
      console.error("Return photo upload failed", e);
    }
  }

  // Update lines (one by one so the validation trigger runs per row)
  for (const l of input.lines) {
    const { error } = await supabase
      .from("laundry_batch_lines" as any)
      .update({
        qty_returned_ok: l.qty_returned_ok,
        qty_short: l.qty_short,
        qty_damaged: l.qty_damaged,
        qty_lost: l.qty_lost,
      })
      .eq("id", l.line_id);
    if (error) throw error;
  }

  // Reconcile queue rows for each linen type
  for (const l of input.lines) {
    const { data: rows, error: rErr } = await supabase
      .from("laundry_queue" as any)
      .select("id")
      .eq("batch_id", input.batch_id)
      .eq("linen_type_id", l.linen_type_id)
      .eq("processing_method", "vendor")
      .order("business_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (rErr) throw rErr;
    const ids = (rows ?? []).map((r: any) => r.id as string);
    // Allocate in order: short (roll forward), damaged, lost, then OK.
    let idx = 0;
    const shortIds = ids.slice(idx, idx += l.qty_short);
    const dmgIds   = ids.slice(idx, idx += l.qty_damaged);
    const lostIds  = ids.slice(idx, idx += l.qty_lost);
    const okIds    = ids.slice(idx);

    if (shortIds.length > 0) {
      const { error } = await supabase.from("laundry_queue" as any)
        .update({ state: "queued", batch_id: null, processing_method: null })
        .in("id", shortIds);
      if (error) throw error;
    }
    if (dmgIds.length > 0 || lostIds.length > 0) {
      const woIds = [...dmgIds, ...lostIds];
      const { error } = await supabase.from("laundry_queue" as any)
        .update({ state: "written_off" })
        .in("id", woIds);
      if (error) throw error;
    }
    if (okIds.length > 0) {
      const { error } = await supabase.from("laundry_queue" as any)
        .update({ state: "returned" })
        .in("id", okIds);
      if (error) throw error;
    }
  }

  // Flip the batch — do this last, after the validation-sensitive line updates.
  const { data: updated, error: uErr } = await supabase
    .from("laundry_batches" as any)
    .update({
      state: "returned",
      returned_at: new Date().toISOString(),
      returned_by_user_id: input.performer.id,
      returned_by_name: input.performer.name,
      return_remarks: input.return_remarks?.trim() || null,
      ...(returnPhotoPath ? { return_photo_path: returnPhotoPath } : {}),
    })
    .eq("id", input.batch_id)
    .select()
    .single();
  if (uErr) throw uErr;

  const totalOk = input.lines.reduce((s, l) => s + l.qty_returned_ok, 0);
  const totalShort = input.lines.reduce((s, l) => s + l.qty_short, 0);
  const totalDmg = input.lines.reduce((s, l) => s + l.qty_damaged, 0);
  const totalLost = input.lines.reduce((s, l) => s + l.qty_lost, 0);

  const shortfallParts = input.lines
    .filter((l) => l.qty_short + l.qty_damaged + l.qty_lost > 0)
    .map((l) => {
      const bits = [];
      if (l.qty_short) bits.push(`${l.qty_short} short`);
      if (l.qty_damaged) bits.push(`${l.qty_damaged} damaged`);
      if (l.qty_lost) bits.push(`${l.qty_lost} lost`);
      return `${l.linen_name_at_time}: ${bits.join(", ")}`;
    })
    .join(" · ");

  void logActivity({
    page: "laundry",
    action: "laundry_batch_returned",
    entity_type: "laundry_batch",
    entity_id: b.id,
    entity_reference: b.batch_number,
    summary: totalShort + totalDmg + totalLost === 0
      ? `Returned ${totalOk} pieces from ${b.vendor_name_at_time} — all OK`
      : `Returned ${totalOk} OK from ${b.vendor_name_at_time} · ${shortfallParts}`,
    metadata: {
      total_ok: totalOk,
      total_short: totalShort,
      total_damaged: totalDmg,
      total_lost: totalLost,
      lines: input.lines,
    },
    correlation_id: b.correlation_id,
    source: "manual",
  });

  return updated as unknown as LaundryBatchRow;
}

export async function listBatches(opts?: {
  vendorId?: string;
  state?: LaundryBatchState;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}): Promise<LaundryBatchRow[]> {
  let q = supabase
    .from("laundry_batches" as any)
    .select("*")
    .order("business_date", { ascending: false })
    .order("sent_at", { ascending: false });
  if (opts?.vendorId) q = q.eq("vendor_id", opts.vendorId);
  if (opts?.state) q = q.eq("state", opts.state);
  if (opts?.fromDate) q = q.gte("business_date", opts.fromDate);
  if (opts?.toDate) q = q.lte("business_date", opts.toDate);
  const { data, error } = await q.limit(opts?.limit ?? 100);
  if (error) throw error;
  return (data ?? []) as any;
}

export async function getBatch(id: string): Promise<{
  batch: LaundryBatchRow;
  lines: LaundryBatchLineRow[];
} | null> {
  const { data: batch, error: bErr } = await supabase
    .from("laundry_batches" as any).select("*").eq("id", id).maybeSingle();
  if (bErr) throw bErr;
  if (!batch) return null;
  const { data: lines, error: lErr } = await supabase
    .from("laundry_batch_lines" as any).select("*").eq("batch_id", id).order("linen_name_at_time");
  if (lErr) throw lErr;
  return { batch: batch as any, lines: (lines ?? []) as any };
}

/* ─────────────────────────  Photo helpers  ───────────────────────── */

async function resizeImage(file: File, maxSide = 1200): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * ratio);
  const h = Math.round(bitmap.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return await new Promise((res) => canvas.toBlob((b) => res(b ?? file), "image/jpeg", 0.85));
}

export async function uploadLaundryPhoto(
  batchId: string,
  kind: "pickup" | "return",
  file: File,
): Promise<string> {
  const blob = await resizeImage(file, 1200);
  const path = `${batchId}/${kind}_${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(SLIP_BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) throw error;
  return path;
}

export async function signedLaundryPhotoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(SLIP_BUCKET).createSignedUrl(path, 300);
  if (error) return null;
  return data.signedUrl;
}
