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
import { logActivity } from "@/lib/activity-log";

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
  pickup_photo_paths: string[];
  return_photo_paths: string[];
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
  /** Deprecated single-file entrypoint. Prefer `slipPhotoFiles`. */
  slipPhotoFile?: File | null;
  slipPhotoFiles?: File[];
}

/**
 * Create a batch atomically via the `create_laundry_batch` Postgres RPC.
 *
 * The RPC performs all row inserts, queue flips, and activity_log writes
 * inside a single database transaction — if any step fails, the whole
 * operation rolls back. Photos are uploaded to storage *before* the RPC
 * call under a staged path; a failed upload is non-fatal. Multiple photos
 * are supported — the RPC receives the first as the legacy single-path
 * field, and we UPDATE the array column with the full set right after.
 */
export async function createBatch(input: CreateBatchInput): Promise<LaundryBatchRow> {
  if (!input.vendor_id) throw new Error("Vendor is required");
  const activeLines = input.lines.filter(
    (l) => l.qty_heos_queue > 0 || l.qty_sent > 0,
  );
  if (activeLines.length === 0) throw new Error("Nothing to send — the queue is empty");

  const files = (input.slipPhotoFiles && input.slipPhotoFiles.length > 0)
    ? input.slipPhotoFiles
    : (input.slipPhotoFile ? [input.slipPhotoFile] : []);

  const stagedId = crypto.randomUUID();
  const uploaded: string[] = [];
  for (const f of files) {
    try {
      uploaded.push(await uploadLaundryPhoto(stagedId, "pickup", f));
    } catch (e) {
      console.error("Pickup slip photo upload failed", e);
    }
  }

  const { data, error } = await supabase.rpc("create_laundry_batch" as any, {
    p_vendor_id: input.vendor_id,
    p_vendor_name: input.vendor_name_at_time,
    p_business_date: input.business_date,
    p_vendor_slip_number: input.vendor_slip_number ?? null,
    p_pickup_remarks: input.pickup_remarks ?? null,
    p_pickup_slip_photo_path: uploaded[0] ?? null,
    p_performer_id: input.performer.id,
    p_performer_name: input.performer.name,
    p_lines: activeLines.map((l) => ({
      linen_type_id: l.linen_type_id,
      linen_name_at_time: l.linen_name_at_time,
      qty_heos_queue: Math.floor(l.qty_heos_queue),
      qty_sent: Math.floor(l.qty_sent),
    })),
  });
  if (error) throw error;
  const batch = data as unknown as LaundryBatchRow;
  if (uploaded.length > 0) {
    await supabase.from("laundry_batches" as any)
      .update({ pickup_photo_paths: uploaded })
      .eq("id", batch.id);
    batch.pickup_photo_paths = uploaded;
  }
  return batch;
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
  /** Deprecated single-file entrypoint. Prefer `returnPhotoFiles`. */
  returnPhotoFile?: File | null;
  returnPhotoFiles?: File[];
}

/**
 * Confirm return atomically via the `confirm_laundry_return` Postgres RPC.
 *
 * The RPC validates per-line sums, updates batch lines, reconciles queue
 * rows (OK → returned, Short → re-queued for rollover, Damaged/Lost →
 * written_off), flips the batch to `returned`, and writes the activity log
 * — all inside a single transaction. Return photos are uploaded first;
 * failed uploads are non-fatal. The RPC receives the first path in the
 * legacy single-path field; the full array is UPDATE'd right after.
 */
export async function confirmReturn(input: ConfirmReturnInput): Promise<LaundryBatchRow> {
  const files = (input.returnPhotoFiles && input.returnPhotoFiles.length > 0)
    ? input.returnPhotoFiles
    : (input.returnPhotoFile ? [input.returnPhotoFile] : []);
  const uploaded: string[] = [];
  for (const f of files) {
    try {
      uploaded.push(await uploadLaundryPhoto(input.batch_id, "return", f));
    } catch (e) {
      console.error("Return photo upload failed", e);
    }
  }

  const { data, error } = await supabase.rpc("confirm_laundry_return" as any, {
    p_batch_id: input.batch_id,
    p_return_remarks: input.return_remarks ?? null,
    p_return_photo_path: uploaded[0] ?? null,
    p_performer_id: input.performer.id,
    p_performer_name: input.performer.name,
    p_lines: input.lines.map((l) => ({
      line_id: l.line_id,
      linen_type_id: l.linen_type_id,
      linen_name_at_time: l.linen_name_at_time,
      qty_sent: l.qty_sent,
      qty_returned_ok: l.qty_returned_ok,
      qty_short: l.qty_short,
      qty_damaged: l.qty_damaged,
      qty_lost: l.qty_lost,
    })),
  });
  if (error) throw error;
  const batch = data as unknown as LaundryBatchRow;
  if (uploaded.length > 0) {
    await supabase.from("laundry_batches" as any)
      .update({ return_photo_paths: uploaded })
      .eq("id", batch.id);
    batch.return_photo_paths = uploaded;
  }
  return batch;
}

/* ─────────────────────  Admin edit of a returned batch  ──────────────── */

export interface EditReturnedLineInput {
  line_id: string;
  qty_returned_ok: number;
  qty_short: number;
  qty_damaged: number;
  qty_lost: number;
}

/**
 * Admin/Owner correction of a *returned* batch's per-linen tallies. This
 * only fixes the counting record on `laundry_batch_lines`; the queue-flip
 * side effects from the original `confirm_laundry_return` are NOT re-run.
 * Rationale: counts on returned batches are usually off by 1–2 pieces from
 * miscounts at pickup — re-running the queue reconciliation would double-
 * write. If an entire batch was mis-recorded, the correct workflow is to
 * void and recreate the batch.
 *
 * The correction is logged verbosely in `activity_log` for audit trail.
 */
export async function editReturnedBatchLines(
  batchId: string,
  edits: EditReturnedLineInput[],
  performer: { id: string; name: string },
  reason?: string | null,
): Promise<void> {
  const { data: batch, error: bErr } = await supabase
    .from("laundry_batches" as any).select("*").eq("id", batchId).single();
  if (bErr) throw bErr;
  const b = batch as unknown as LaundryBatchRow;
  if (b.state !== "returned") throw new Error("Only returned batches can be corrected");

  const { data: existingLines, error: lErr } = await supabase
    .from("laundry_batch_lines" as any).select("*").eq("batch_id", batchId);
  if (lErr) throw lErr;
  const byId = new Map<string, LaundryBatchLineRow>();
  for (const l of ((existingLines ?? []) as any[]) as LaundryBatchLineRow[]) byId.set(l.id, l);

  const changes: string[] = [];
  for (const e of edits) {
    const cur = byId.get(e.line_id);
    if (!cur) continue;
    const total = e.qty_returned_ok + e.qty_short + e.qty_damaged + e.qty_lost;
    if (total !== cur.qty_sent) {
      throw new Error(`${cur.linen_name_at_time}: OK+Short+Dmg+Lost (${total}) must equal Sent (${cur.qty_sent})`);
    }
    if (
      e.qty_returned_ok !== cur.qty_returned_ok
      || e.qty_short !== cur.qty_short
      || e.qty_damaged !== cur.qty_damaged
      || e.qty_lost !== cur.qty_lost
    ) {
      const { error: uErr } = await supabase
        .from("laundry_batch_lines" as any)
        .update({
          qty_returned_ok: e.qty_returned_ok,
          qty_short: e.qty_short,
          qty_damaged: e.qty_damaged,
          qty_lost: e.qty_lost,
        })
        .eq("id", e.line_id);
      if (uErr) throw uErr;
      changes.push(
        `${cur.linen_name_at_time}: OK ${cur.qty_returned_ok}→${e.qty_returned_ok}, `
        + `Short ${cur.qty_short}→${e.qty_short}, `
        + `Dmg ${cur.qty_damaged}→${e.qty_damaged}, `
        + `Lost ${cur.qty_lost}→${e.qty_lost}`,
      );
    }
  }

  if (changes.length === 0) return;

  void logActivity({
    page: "laundry",
    action: "laundry_batch_return_corrected",
    entity_type: "laundry_batch",
    entity_id: batchId,
    entity_reference: b.batch_number,
    summary: `Corrected return counts on batch ${b.batch_number}${reason ? ` — ${reason}` : ""}`,
    correlation_id: b.correlation_id,
    source: "manual",
    metadata: { changes, corrected_by: performer.name, reason: reason ?? null } as any,
  });
}

/* ────────────  Admin edit of batch metadata & sent counts  ──────────── */

export interface EditBatchMetadataInput {
  vendor_id?: string | null;
  vendor_name_at_time?: string | null;
  vendor_slip_number?: string | null;
  pickup_remarks?: string | null;
  return_remarks?: string | null;
  addPickupPhotos?: File[];
  addReturnPhotos?: File[];
}

/**
 * Admin/Owner edit of batch header fields (vendor, slip #, remarks) and
 * photos. Works for both `sent` and `returned` batches. Photos are
 * additive — existing photos are preserved; use the array columns.
 * All changes are logged verbosely to `activity_log` for audit trail.
 */
export async function editBatchMetadata(
  batchId: string,
  edits: EditBatchMetadataInput,
  performer: { id: string; name: string },
  reason?: string | null,
): Promise<LaundryBatchRow> {
  const { data: batch, error: bErr } = await supabase
    .from("laundry_batches" as any).select("*").eq("id", batchId).single();
  if (bErr) throw bErr;
  const b = batch as unknown as LaundryBatchRow;
  if (b.state === "cancelled") throw new Error("Cannot edit a cancelled batch");

  const patch: Record<string, any> = {};
  const changes: string[] = [];

  if (edits.vendor_id != null && edits.vendor_id !== b.vendor_id) {
    patch.vendor_id = edits.vendor_id;
    patch.vendor_name_at_time = edits.vendor_name_at_time ?? b.vendor_name_at_time;
    changes.push(`Vendor: ${b.vendor_name_at_time} → ${patch.vendor_name_at_time}`);
  }
  if (edits.vendor_slip_number !== undefined && (edits.vendor_slip_number ?? null) !== (b.vendor_slip_number ?? null)) {
    patch.vendor_slip_number = edits.vendor_slip_number ?? null;
    changes.push(`Slip #: ${b.vendor_slip_number ?? "—"} → ${patch.vendor_slip_number ?? "—"}`);
  }
  if (edits.pickup_remarks !== undefined && (edits.pickup_remarks ?? null) !== (b.pickup_remarks ?? null)) {
    patch.pickup_remarks = edits.pickup_remarks ?? null;
    changes.push(`Pickup remarks changed`);
  }
  if (edits.return_remarks !== undefined && (edits.return_remarks ?? null) !== (b.return_remarks ?? null)) {
    patch.return_remarks = edits.return_remarks ?? null;
    changes.push(`Return remarks changed`);
  }

  // Photo additions
  const addedPickup: string[] = [];
  for (const f of (edits.addPickupPhotos ?? [])) {
    try { addedPickup.push(await uploadLaundryPhoto(batchId, "pickup", f)); }
    catch (e) { console.error("pickup photo add failed", e); }
  }
  const addedReturn: string[] = [];
  for (const f of (edits.addReturnPhotos ?? [])) {
    try { addedReturn.push(await uploadLaundryPhoto(batchId, "return", f)); }
    catch (e) { console.error("return photo add failed", e); }
  }
  if (addedPickup.length > 0) {
    patch.pickup_photo_paths = [...(b.pickup_photo_paths ?? []), ...addedPickup];
    changes.push(`+${addedPickup.length} pickup photo(s)`);
  }
  if (addedReturn.length > 0) {
    patch.return_photo_paths = [...(b.return_photo_paths ?? []), ...addedReturn];
    changes.push(`+${addedReturn.length} return photo(s)`);
  }

  if (Object.keys(patch).length === 0) return b;

  const { data: updated, error: uErr } = await supabase
    .from("laundry_batches" as any).update(patch).eq("id", batchId).select().single();
  if (uErr) throw uErr;

  void logActivity({
    page: "laundry",
    action: "laundry_batch_edited",
    entity_type: "laundry_batch",
    entity_id: batchId,
    entity_reference: b.batch_number,
    summary: `Edited batch ${b.batch_number}${reason ? ` — ${reason}` : ""}`,
    correlation_id: b.correlation_id,
    source: "manual",
    metadata: { changes, edited_by: performer.name, reason: reason ?? null } as any,
  });

  return updated as unknown as LaundryBatchRow;
}

export interface EditSentLineInput {
  line_id: string;
  qty_sent: number;
}

/**
 * Admin/Owner correction of a *sent* batch's per-linen sent counts. Only
 * allowed while the batch is `sent` (not yet returned) — once returned,
 * use `editReturnedBatchLines` to adjust the OK/short/damaged/lost split.
 *
 * This does NOT re-flip laundry_queue rows: if a mis-count is significant
 * enough to affect the queue reconciliation, the correct workflow is to
 * cancel the batch and recreate it. Small counting adjustments (±1–2 pieces
 * from re-count with the vendor before the truck leaves) are the intended
 * use case. All changes are logged verbosely.
 */
export async function editSentBatchLines(
  batchId: string,
  edits: EditSentLineInput[],
  performer: { id: string; name: string },
  reason?: string | null,
): Promise<void> {
  const { data: batch, error: bErr } = await supabase
    .from("laundry_batches" as any).select("*").eq("id", batchId).single();
  if (bErr) throw bErr;
  const b = batch as unknown as LaundryBatchRow;
  if (b.state !== "sent") throw new Error("Only in-flight (sent) batches allow sent-count edits");

  const { data: existing, error: lErr } = await supabase
    .from("laundry_batch_lines" as any).select("*").eq("batch_id", batchId);
  if (lErr) throw lErr;
  const byId = new Map<string, LaundryBatchLineRow>();
  for (const l of ((existing ?? []) as any[]) as LaundryBatchLineRow[]) byId.set(l.id, l);

  const changes: string[] = [];
  for (const e of edits) {
    const cur = byId.get(e.line_id);
    if (!cur) continue;
    const nextSent = Math.max(0, Math.floor(e.qty_sent));
    if (nextSent === cur.qty_sent) continue;
    const nextInHouse = Math.max(0, cur.qty_heos_queue - nextSent);
    const { error: uErr } = await supabase
      .from("laundry_batch_lines" as any)
      .update({ qty_sent: nextSent, qty_in_house: nextInHouse })
      .eq("id", e.line_id);
    if (uErr) throw uErr;
    changes.push(`${cur.linen_name_at_time}: Sent ${cur.qty_sent}→${nextSent}`);
  }

  if (changes.length === 0) return;

  void logActivity({
    page: "laundry",
    action: "laundry_batch_sent_counts_corrected",
    entity_type: "laundry_batch",
    entity_id: batchId,
    entity_reference: b.batch_number,
    summary: `Corrected sent counts on batch ${b.batch_number}${reason ? ` — ${reason}` : ""}`,
    correlation_id: b.correlation_id,
    source: "manual",
    metadata: { changes, corrected_by: performer.name, reason: reason ?? null } as any,
  });
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
