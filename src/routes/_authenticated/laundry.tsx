/**
 * Laundry — Phase 3B Ship 1 (send path).
 *
 * Two tabs:
 *   • Queue    — aggregated pending linen with a "New Pickup" CTA.
 *   • Batches  — chronological list of created batches, filterable by
 *                vendor / state / month.
 *
 * The Ship 2 return path (per-linen OK/short/damaged/lost) is stubbed
 * as a read-only detail dialog for now.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ArrowLeft, Truck, ClipboardList, AlertTriangle, ChevronRight, XCircle, Pencil, Save } from "lucide-react";
import { toast } from "sonner";
import { getBusinessDate } from "@/lib/night-audit-api";
import { listVendors, type VendorRow } from "@/lib/vendors-api";
import {
  previewPickup, createBatch, listBatches, cancelBatch, getBatch, confirmReturn, signedLaundryPhotoUrl,
  editReturnedBatchLines,
  type LaundryBatchRow, type LaundryBatchLineRow, type LaundryBatchState, type PickupPreviewRow,
} from "@/lib/laundry-batches-api";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import { useUserRole } from "@/hooks/use-role";
import { PhotoPicker } from "@/components/photo-picker";
import { ImageLightbox } from "@/components/image-lightbox";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/laundry")({
  component: LaundryPage,
  head: () => ({
    meta: [
      { title: "Laundry · Hotel Excella" },
      { name: "description", content: "Manage laundry pickup batches and returns." },
    ],
  }),
});

type Tab = "queue" | "batches";

function LaundryPage() {
  const me = useCurrentStaff();
  const [tab, setTab] = useState<Tab>("queue");
  const [pickupOpen, setPickupOpen] = useState(false);
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null);

  const { data: businessDate } = useQuery({ queryKey: ["business-date"], queryFn: getBusinessDate, staleTime: 30_000 });

  if (pickupOpen && businessDate) {
    return (
      <PickupScreen
        businessDate={businessDate as string}
        onClose={() => setPickupOpen(false)}
        me={{ id: me.id ?? "", name: me.name || me.firstName || "user" }}
      />
    );
  }
  if (detailBatchId) {
    return <BatchDetailScreen batchId={detailBatchId} onClose={() => setDetailBatchId(null)} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 bg-background/85 backdrop-blur border-b border-border">
        <div className="px-4 py-3 max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Operations</div>
            <div className="font-display text-lg leading-tight">Laundry</div>
          </div>
          {tab === "queue" && (
            <button
              onClick={() => setPickupOpen(true)}
              disabled={!businessDate}
              className="px-3 py-2 rounded-md bg-gold text-charcoal text-xs font-medium shadow-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Truck className="h-3.5 w-3.5" /> New Pickup
            </button>
          )}
        </div>
        <div className="px-4 max-w-3xl mx-auto flex gap-1 -mb-px">
          {(["queue", "batches"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                "px-3 py-2 text-xs uppercase tracking-wider border-b-2",
                tab === k ? "text-gold border-gold" : "text-muted-foreground border-transparent",
              )}
            >
              {k === "queue" ? "Queue" : "Batches"}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 py-6 max-w-3xl mx-auto">
        {tab === "queue" && businessDate && <QueueTab businessDate={businessDate as string} />}
        {tab === "batches" && <BatchesTab onOpen={(id) => setDetailBatchId(id)} />}
      </div>
    </div>
  );
}

/* ─────────────────────────────  Queue Tab  ───────────────────────────── */

function QueueTab({ businessDate }: { businessDate: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["laundry-preview", businessDate],
    queryFn: () => previewPickup(businessDate),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>;
  }
  const rows = data?.rows ?? [];
  const total = rows.reduce((s, r) => s + r.heos_queue, 0);
  const prev = rows.reduce((s, r) => s + r.prev_missing, 0);
  const days = data?.oldestDays ?? 0;

  return (
    <div className="space-y-4">
      {days >= 2 && (
        <div className={cn(
          "rounded-lg border px-3 py-2 flex items-center gap-2 text-xs",
          days >= 4 ? "border-red-500/40 bg-red-500/5 text-red-500" : "border-amber-500/40 bg-amber-500/5 text-amber-500",
        )}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div>Oldest Pending Pickup: <b>{days} days</b> — dispatch a batch soon.</div>
        </div>
      )}
      <div className="luxe-card rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">HEOS Queue</div>
            <div className="text-sm">Pending linen aggregated by type</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total pieces</div>
            <div className="text-lg font-display text-gold">{total}</div>
          </div>
        </div>
        <div className="divide-y divide-border/60">
          {rows.filter((r) => r.heos_queue > 0).map((r) => (
            <div key={r.linen_type_id} className="px-4 py-2.5 flex items-center justify-between text-sm">
              <div>
                <div>{r.linen_name}</div>
                {r.prev_missing > 0 && (
                  <div className="text-[10px] text-amber-500 mt-0.5">
                    incl. {r.prev_missing} from previous batches
                  </div>
                )}
              </div>
              <div className="text-base font-medium">{r.heos_queue}</div>
            </div>
          ))}
          {rows.every((r) => r.heos_queue === 0) && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              Nothing queued for laundry right now.
            </div>
          )}
        </div>
        {prev > 0 && (
          <div className="px-4 py-2 border-t border-border/60 text-[11px] text-muted-foreground">
            {prev} pieces have been waiting from earlier days.
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────  Batches Tab  ───────────────────────── */

function BatchesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [vendorId, setVendorId] = useState<string>("");
  const [state, setState] = useState<"" | "sent" | "returned" | "cancelled">("");

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors-laundry"],
    queryFn: () => listVendors({ activeOnly: true, kind: "laundry" }),
    staleTime: 60_000,
  });

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ["laundry-batches", vendorId, state],
    queryFn: () => listBatches({ vendorId: vendorId || undefined, state: state || undefined, limit: 100 }),
    staleTime: 15_000,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          className="bg-input/60 border border-border rounded-md px-2 py-1.5 text-xs"
        >
          <option value="">All laundry vendors</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
        <select
          value={state}
          onChange={(e) => setState(e.target.value as any)}
          className="bg-input/60 border border-border rounded-md px-2 py-1.5 text-xs"
        >
          <option value="">All states</option>
          <option value="sent">Sent (awaiting return)</option>
          <option value="returned">Returned</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      {isLoading ? (
        <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : batches.length === 0 ? (
        <div className="luxe-card rounded-lg p-8 text-center text-xs text-muted-foreground">
          No batches yet.
        </div>
      ) : (
        <div className="luxe-card rounded-lg divide-y divide-border/60">
          {batches.map((b) => <BatchRow key={b.id} batch={b} onOpen={() => onOpen(b.id)} />)}
        </div>
      )}
    </div>
  );
}

function BatchRow({ batch, onOpen }: { batch: LaundryBatchRow; onOpen: () => void }) {
  const stateColor = batch.state === "sent" ? "text-amber-500" : batch.state === "returned" ? "text-emerald-500" : "text-muted-foreground";
  return (
    <button onClick={onOpen} className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-muted/20">
      <div>
        <div className="text-sm font-medium">{batch.batch_number}</div>
        <div className="text-[11px] text-muted-foreground">
          {batch.vendor_name_at_time} · {new Date(batch.sent_at).toLocaleDateString()}
          {batch.vendor_slip_number && <> · slip #{batch.vendor_slip_number}</>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn("text-[11px] uppercase tracking-wider", stateColor)}>{batch.state}</span>
        <ChevronRight className="h-4 w-4 text-gold" />
      </div>
    </button>
  );
}

/* ─────────────────────────────  Pickup Screen  ───────────────────────── */

function PickupScreen({ businessDate, onClose, me }: {
  businessDate: string;
  onClose: () => void;
  me: { id: string; name: string };
}) {
  const qc = useQueryClient();
  const { data: preview, isLoading } = useQuery({
    queryKey: ["laundry-preview", businessDate],
    queryFn: () => previewPickup(businessDate),
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors-laundry"],
    queryFn: () => listVendors({ activeOnly: true, kind: "laundry" }),
  });
  const { data: allVendors = [] } = useQuery({
    queryKey: ["vendors-all-active"],
    queryFn: () => listVendors({ activeOnly: true }),
    staleTime: 60_000,
  });

  const laundryVendors = vendors.length > 0 ? vendors : allVendors; // fallback if none tagged yet

  const [vendorId, setVendorId] = useState<string>("");
  const [slipNumber, setSlipNumber] = useState("");
  const [remarks, setRemarks] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [sent, setSent] = useState<Record<string, number>>({});

  // Default vendor: prefer "WeWash Laundry" (per operational spec), else first laundry vendor.
  useEffect(() => {
    if (vendorId || laundryVendors.length === 0) return;
    const weWash = (laundryVendors as VendorRow[]).find((v) => /we\s*wash/i.test(v.name));
    setVendorId((weWash ?? laundryVendors[0]).id);
  }, [vendorId, laundryVendors]);

  // Initialize sent quantities = HEOS queue count when preview arrives.
  useEffect(() => {
    if (!preview) return;
    setSent((prev) => {
      const next = { ...prev };
      for (const r of preview.rows) {
        if (next[r.linen_type_id] == null) next[r.linen_type_id] = r.heos_queue;
      }
      return next;
    });
  }, [preview]);

  const rows: PickupPreviewRow[] = preview?.rows ?? [];
  const days = preview?.oldestDays ?? 0;
  const activeRows = rows.filter((r) => r.heos_queue > 0);

  const totals = useMemo(() => {
    let heos = 0, sentTotal = 0;
    for (const r of activeRows) {
      heos += r.heos_queue;
      sentTotal += Math.max(0, Math.min(sent[r.linen_type_id] ?? 0, r.heos_queue));
    }
    return { heos, sentTotal, inHouse: heos - sentTotal };
  }, [activeRows, sent]);

  const confirmMut = useMutation({
    mutationFn: async () => {
      if (!vendorId) throw new Error("Choose a vendor");
      const vendor = (laundryVendors as VendorRow[]).find((v) => v.id === vendorId);
      if (!vendor) throw new Error("Vendor not found");
      if (!me.id) throw new Error("Not signed in");
      const lines = activeRows.map((r) => ({
        linen_type_id: r.linen_type_id,
        linen_name_at_time: r.linen_name,
        qty_heos_queue: r.heos_queue,
        qty_sent: Math.max(0, Math.min(Math.floor(Number(sent[r.linen_type_id] ?? 0)), r.heos_queue)),
      }));
      return createBatch({
        vendor_id: vendor.id,
        vendor_name_at_time: vendor.name,
        business_date: businessDate,
        vendor_slip_number: slipNumber || null,
        pickup_remarks: remarks || null,
        lines,
        performer: me,
        slipPhotoFiles: photoFiles,
      });
    },
    onSuccess: (b) => {
      toast.success(`Batch ${b.batch_number} sent`);
      qc.invalidateQueries({ queryKey: ["laundry-preview"] });
      qc.invalidateQueries({ queryKey: ["laundry-batches"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 bg-background/85 backdrop-blur border-b border-border">
        <div className="px-4 py-3 max-w-3xl mx-auto flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted"><ArrowLeft className="h-4 w-4" /></button>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">New Pickup</div>
            <div className="font-display text-base leading-tight">Laundry Batch</div>
          </div>
          {days >= 2 && (
            <div className="text-[10px] flex items-center gap-1 text-amber-500">
              <AlertTriangle className="h-3.5 w-3.5" />Oldest: {days}d
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-6 max-w-3xl mx-auto space-y-5">
        <div className="luxe-card rounded-lg p-3 space-y-2">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Vendor</label>
          <select
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
          >
            <option value="">Select vendor…</option>
            {laundryVendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          {vendors.length === 0 && (
            <div className="text-[10px] text-muted-foreground">
              No vendors tagged as "laundry". Showing all active vendors — tag them from the Vendors screen.
            </div>
          )}
        </div>

        <div className="luxe-card rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 items-center gap-2 px-4 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
            <div className="col-span-5">Linen Type</div>
            <div className="col-span-2 text-right">HEOS</div>
            <div className="col-span-2 text-right">Prev</div>
            <div className="col-span-3 text-right">Sent</div>
          </div>
          {activeRows.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              Nothing queued right now.
            </div>
          )}
          {activeRows.map((r) => (
            <div key={r.linen_type_id} className="grid grid-cols-12 items-center gap-2 px-4 py-2.5 border-b border-border/60 text-sm">
              <div className="col-span-5">{r.linen_name}</div>
              <div className="col-span-2 text-right text-muted-foreground">{r.heos_queue}</div>
              <div className="col-span-2 text-right text-amber-500">{r.prev_missing || "—"}</div>
              <div className="col-span-3 text-right">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={r.heos_queue}
                  value={sent[r.linen_type_id] ?? 0}
                  onChange={(e) => setSent((s) => ({ ...s, [r.linen_type_id]: Number(e.target.value) }))}
                  className="w-20 bg-input/60 border border-border rounded-md px-2 py-1 text-right text-sm"
                />
              </div>
            </div>
          ))}
          {activeRows.length > 0 && (
            <div className="px-4 py-2 grid grid-cols-12 items-center gap-2 text-[11px] bg-muted/20">
              <div className="col-span-5 text-muted-foreground">Totals</div>
              <div className="col-span-2 text-right">{totals.heos}</div>
              <div className="col-span-2 text-right"></div>
              <div className="col-span-3 text-right font-medium text-gold">{totals.sentTotal}</div>
            </div>
          )}
        </div>

        {totals.inHouse > 0 && (
          <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2 text-xs">
            <b className="text-gold">{totals.inHouse}</b> pieces will be marked as <b>washed in-house</b> (HEOS queue − sent).
          </div>
        )}

        <div className="luxe-card rounded-lg p-3 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Vendor Slip # <span className="text-muted-foreground/60">(optional)</span></label>
            <input
              type="text"
              value={slipNumber}
              onChange={(e) => setSlipNumber(e.target.value)}
              placeholder="e.g. WW-4471"
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm mt-1"
            />
          </div>
          <PhotoPicker
            label="Pickup Slip Photos (optional)"
            files={photoFiles}
            onFilesChange={setPhotoFiles}
          />
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Pickup Remarks</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm mt-1"
            />
          </div>
        </div>

        <button
          onClick={() => confirmMut.mutate()}
          disabled={confirmMut.isPending || !vendorId || activeRows.length === 0}
          className="w-full py-3 rounded-md bg-gold text-charcoal font-medium disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {confirmMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirm Pickup
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────  Batch Detail  ───────────────────────── */

function BatchDetailScreen({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useCurrentStaff();
  const { data, isLoading } = useQuery({
    queryKey: ["laundry-batch", batchId],
    queryFn: () => getBatch(batchId),
  });
  const { role } = useUserRole();
  const canEditReturn = role === "admin" || role === "owner";
  const [pickupUrls, setPickupUrls] = useState<string[]>([]);
  const [returnUrls, setReturnUrls] = useState<string[]>([]);
  const [returnMode, setReturnMode] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [lightboxUrls, setLightboxUrls] = useState<string[] | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!data) return;
      const pickupList = (data.batch.pickup_photo_paths && data.batch.pickup_photo_paths.length > 0)
        ? data.batch.pickup_photo_paths
        : (data.batch.pickup_slip_photo_path ? [data.batch.pickup_slip_photo_path] : []);
      const returnList = (data.batch.return_photo_paths && data.batch.return_photo_paths.length > 0)
        ? data.batch.return_photo_paths
        : (data.batch.return_photo_path ? [data.batch.return_photo_path] : []);
      const [p, r] = await Promise.all([
        Promise.all(pickupList.map((p) => signedLaundryPhotoUrl(p))),
        Promise.all(returnList.map((p) => signedLaundryPhotoUrl(p))),
      ]);
      if (!alive) return;
      setPickupUrls(p.filter((u): u is string => !!u));
      setReturnUrls(r.filter((u): u is string => !!u));
    })();
    return () => { alive = false; };
  }, [data]);

  const cancelMut = useMutation({
    mutationFn: async () => {
      if (!me.id) throw new Error("Not signed in");
      await cancelBatch(batchId, { id: me.id, name: me.name || me.firstName || "user" });
    },
    onSuccess: () => {
      toast.success("Batch cancelled");
      qc.invalidateQueries({ queryKey: ["laundry-batches"] });
      qc.invalidateQueries({ queryKey: ["laundry-preview"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  }
  const { batch, lines } = data;

  if (returnMode && batch.state === "sent") {
    return (
      <ReturnScreen
        batch={batch}
        lines={lines}
        me={{ id: me.id ?? "", name: me.name || me.firstName || "user" }}
        onClose={() => setReturnMode(false)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ["laundry-batch", batchId] });
          qc.invalidateQueries({ queryKey: ["laundry-batches"] });
          qc.invalidateQueries({ queryKey: ["laundry-preview"] });
          setReturnMode(false);
        }}
      />
    );
  }

  if (editMode && batch.state === "returned") {
    return (
      <EditReturnScreen
        batch={batch}
        lines={lines}
        me={{ id: me.id ?? "", name: me.name || me.firstName || "user" }}
        onClose={() => setEditMode(false)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ["laundry-batch", batchId] });
          qc.invalidateQueries({ queryKey: ["laundry-batches"] });
          setEditMode(false);
        }}
      />
    );
  }

  const totals = lines.reduce(
    (a, l) => ({
      heos: a.heos + l.qty_heos_queue,
      sent: a.sent + l.qty_sent,
      inHouse: a.inHouse + l.qty_in_house,
      ok: a.ok + l.qty_returned_ok,
      short: a.short + l.qty_short,
      dmg: a.dmg + l.qty_damaged,
      lost: a.lost + l.qty_lost,
    }),
    { heos: 0, sent: 0, inHouse: 0, ok: 0, short: 0, dmg: 0, lost: 0 },
  );
  const outstanding = totals.sent - (totals.ok + totals.short + totals.dmg + totals.lost);

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 bg-background/85 backdrop-blur border-b border-border">
        <div className="px-4 py-3 max-w-3xl mx-auto flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted"><ArrowLeft className="h-4 w-4" /></button>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Batch</div>
            <div className="font-display text-base leading-tight truncate">{batch.batch_number}</div>
          </div>
          <span className={cn(
            "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0",
            batch.state === "sent" ? "bg-amber-500/10 text-amber-500" :
            batch.state === "returned" ? "bg-emerald-500/10 text-emerald-500" :
            "bg-muted/40 text-muted-foreground",
          )}>{batch.state}</span>
        </div>
      </div>

      <div className="px-4 py-6 max-w-3xl mx-auto space-y-4">
        <div className="luxe-card rounded-lg p-3 text-sm space-y-1">
          <div><b>Vendor:</b> {batch.vendor_name_at_time}</div>
          <div><b>Business Date:</b> {batch.business_date}</div>
          {batch.vendor_slip_number && <div><b>Slip #:</b> {batch.vendor_slip_number}</div>}
          <div><b>Sent:</b> {new Date(batch.sent_at).toLocaleString()} by {batch.sent_by_name}</div>
          {batch.returned_at && <div><b>Returned:</b> {new Date(batch.returned_at).toLocaleString()} by {batch.returned_by_name}</div>}
        </div>

        {batch.state === "sent" && (
          <button
            onClick={() => setReturnMode(true)}
            className="w-full py-3 rounded-md bg-gold text-charcoal font-medium flex items-center justify-center gap-2"
          >
            <ClipboardList className="h-4 w-4" /> Confirm Return
          </button>
        )}

        {batch.state === "returned" && canEditReturn && (
          <button
            onClick={() => setEditMode(true)}
            className="w-full py-2.5 rounded-md border border-gold/40 text-gold text-sm flex items-center justify-center gap-2 hover:bg-gold/5"
          >
            <Pencil className="h-4 w-4" /> Correct Return Counts
          </button>
        )}

        {/* Mobile-first: one card per linen; desktop keeps the compact grid.  */}
        <div className="space-y-2 md:hidden">
          {lines.map((l) => (
            <LinenLineCard key={l.id} l={l} state={batch.state} />
          ))}
          <div className="luxe-card rounded-lg p-3 text-xs bg-muted/20">
            <div className="font-medium mb-2">Totals</div>
            <div className="grid grid-cols-4 gap-2">
              <TotalCell label="HEOS" value={totals.heos} />
              <TotalCell label="Sent" value={totals.sent} />
              <TotalCell label="In-house" value={totals.inHouse} tone="gold" />
              <TotalCell label="OK" value={totals.ok} />
              <TotalCell label="Short" value={totals.short} tone={totals.short > 0 ? "warning" : "muted"} />
              <TotalCell label="Dmg" value={totals.dmg} tone={totals.dmg > 0 ? "warning" : "muted"} />
              <TotalCell label="Lost" value={totals.lost} tone={totals.lost > 0 ? "destructive" : "muted"} />
              {batch.state === "sent" && outstanding > 0 && (
                <TotalCell label="Outstanding" value={outstanding} tone="warning" />
              )}
            </div>
          </div>
        </div>

        <div className="hidden md:block luxe-card rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">Lines</div>
          <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
            <div className="col-span-4">Linen</div>
            <div className="col-span-1 text-right">HEOS</div>
            <div className="col-span-1 text-right">Sent</div>
            <div className="col-span-1 text-right">In-house</div>
            <div className="col-span-1 text-right">OK</div>
            <div className="col-span-1 text-right">Short</div>
            <div className="col-span-1 text-right">Dmg</div>
            <div className="col-span-1 text-right">Lost</div>
          </div>
          {lines.map((l) => (
            <div key={l.id} className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-border/60 text-xs">
              <div className="col-span-4">{l.linen_name_at_time}</div>
              <div className="col-span-1 text-right">{l.qty_heos_queue}</div>
              <div className="col-span-1 text-right">{l.qty_sent}</div>
              <div className="col-span-1 text-right text-gold">{l.qty_in_house || "—"}</div>
              <div className="col-span-1 text-right">{l.qty_returned_ok || "—"}</div>
              <div className="col-span-1 text-right">{l.qty_short || "—"}</div>
              <div className="col-span-1 text-right">{l.qty_damaged || "—"}</div>
              <div className="col-span-1 text-right">{l.qty_lost || "—"}</div>
            </div>
          ))}
          <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-muted/20 text-xs font-medium">
            <div className="col-span-4">Totals</div>
            <div className="col-span-1 text-right">{totals.heos}</div>
            <div className="col-span-1 text-right">{totals.sent}</div>
            <div className="col-span-1 text-right text-gold">{totals.inHouse}</div>
            <div className="col-span-1 text-right">{totals.ok}</div>
            <div className="col-span-1 text-right">{totals.short}</div>
            <div className="col-span-1 text-right">{totals.dmg}</div>
            <div className="col-span-1 text-right">{totals.lost}</div>
          </div>
          {batch.state === "sent" && outstanding > 0 && (
            <div className="px-4 py-2 border-t border-border/60 text-[11px] text-amber-500">
              Outstanding with vendor: <b>{outstanding}</b> pieces
            </div>
          )}
        </div>

        {(batch.pickup_remarks || batch.return_remarks) && (
          <div className="luxe-card rounded-lg p-3 space-y-2 text-xs">
            {batch.pickup_remarks && <div><b>Pickup remarks:</b> {batch.pickup_remarks}</div>}
            {batch.return_remarks && <div><b>Return remarks:</b> {batch.return_remarks}</div>}
          </div>
        )}

        <PhotoGallery label="Pickup Slip" urls={pickupUrls}
          onOpen={(i) => { setLightboxUrls(pickupUrls); setLightboxIndex(i); }} />
        <PhotoGallery label="Return Bag" urls={returnUrls}
          onOpen={(i) => { setLightboxUrls(returnUrls); setLightboxIndex(i); }} />

        {batch.state === "sent" && (
          <button
            onClick={() => {
              if (!confirm("Cancel this batch and return items to the queue?")) return;
              cancelMut.mutate();
            }}
            disabled={cancelMut.isPending}
            className="w-full py-2.5 rounded-md border border-red-500/40 text-red-500 text-sm flex items-center justify-center gap-2 hover:bg-red-500/5"
          >
            <XCircle className="h-4 w-4" /> Cancel Batch
          </button>
        )}
      </div>
      {lightboxUrls && (
        <ImageLightbox urls={lightboxUrls} index={lightboxIndex} onClose={() => setLightboxUrls(null)} />
      )}
    </div>
  );
}

function LinenLineCard({ l, state }: { l: LaundryBatchLineRow; state: LaundryBatchState }) {
  const returned = state === "returned";
  return (
    <div className="luxe-card rounded-lg p-3 space-y-2">
      <div className="font-medium text-sm">{l.linen_name_at_time}</div>
      <div className="grid grid-cols-4 gap-2 text-[11px]">
        <StatCell label="HEOS" value={l.qty_heos_queue} />
        <StatCell label="Sent" value={l.qty_sent} />
        <StatCell label="In-house" value={l.qty_in_house} tone="gold" />
        {returned ? <StatCell label="OK" value={l.qty_returned_ok} tone="success" /> : <div />}
        {returned && l.qty_short > 0 && <StatCell label="Short" value={l.qty_short} tone="warning" />}
        {returned && l.qty_damaged > 0 && <StatCell label="Dmg" value={l.qty_damaged} tone="warning" />}
        {returned && l.qty_lost > 0 && <StatCell label="Lost" value={l.qty_lost} tone="destructive" />}
      </div>
    </div>
  );
}

function StatCell({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "gold" | "success" | "warning" | "destructive" | "muted" }) {
  const toneCls = tone === "gold" ? "text-gold"
    : tone === "success" ? "text-emerald-500"
    : tone === "warning" ? "text-amber-500"
    : tone === "destructive" ? "text-red-500"
    : tone === "muted" ? "text-muted-foreground" : "";
  return (
    <div className="rounded-md bg-muted/20 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("tabular-nums font-medium", toneCls)}>{value || 0}</div>
    </div>
  );
}
function TotalCell({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "gold" | "success" | "warning" | "destructive" | "muted" }) {
  return <StatCell label={label} value={value} tone={tone} />;
}

function PhotoGallery({ label, urls, onOpen }: { label: string; urls: string[]; onOpen: (index: number) => void }) {
  if (urls.length === 0) return null;
  return (
    <div className="luxe-card rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{label}</div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {urls.map((u, i) => (
          <button key={i} onClick={() => onOpen(i)} className="aspect-square rounded overflow-hidden bg-muted/20 border border-border">
            <img src={u} alt={`${label} ${i + 1}`} className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────  Return Screen  ───────────────────────── */

type ReturnDraft = Record<string, { ok: number; short: number; damaged: number; lost: number }>;

function ReturnScreen({ batch, lines, me, onClose, onDone }: {
  batch: LaundryBatchRow;
  lines: LaundryBatchLineRow[];
  me: { id: string; name: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  // Default: everything returned OK.
  const [draft, setDraft] = useState<ReturnDraft>(() => {
    const d: ReturnDraft = {};
    for (const l of lines) {
      d[l.id] = { ok: l.qty_sent, short: 0, damaged: 0, lost: 0 };
    }
    return d;
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [remarks, setRemarks] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);

  const totals = useMemo(() => {
    let sent = 0, ok = 0, short = 0, dmg = 0, lost = 0;
    for (const l of lines) {
      const d = draft[l.id];
      sent += l.qty_sent;
      ok += d?.ok ?? 0; short += d?.short ?? 0; dmg += d?.damaged ?? 0; lost += d?.lost ?? 0;
    }
    return { sent, ok, short, dmg, lost, unaccounted: sent - ok - short - dmg - lost };
  }, [lines, draft]);

  const anyShortfall = totals.short + totals.dmg + totals.lost > 0;

  const setBucket = (lineId: string, bucket: "short" | "damaged" | "lost", value: number) => {
    setDraft((prev) => {
      const cur = prev[lineId] ?? { ok: 0, short: 0, damaged: 0, lost: 0 };
      const line = lines.find((l) => l.id === lineId);
      if (!line) return prev;
      const v = Math.max(0, Math.floor(value || 0));
      const others = { short: cur.short, damaged: cur.damaged, lost: cur.lost, [bucket]: v };
      const totalIssues = others.short + others.damaged + others.lost;
      if (totalIssues > line.qty_sent) return prev; // ignore over-allocation
      return { ...prev, [lineId]: { ...others, ok: line.qty_sent - totalIssues } };
    });
  };

  const confirmMut = useMutation({
    mutationFn: async () => {
      if (!me.id) throw new Error("Not signed in");
      return confirmReturn({
        batch_id: batch.id,
        return_remarks: remarks || null,
        performer: me,
        returnPhotoFiles: photoFiles,
        lines: lines.map((l) => {
          const d = draft[l.id] ?? { ok: l.qty_sent, short: 0, damaged: 0, lost: 0 };
          return {
            line_id: l.id,
            linen_type_id: l.linen_type_id,
            linen_name_at_time: l.linen_name_at_time,
            qty_sent: l.qty_sent,
            qty_returned_ok: d.ok,
            qty_short: d.short,
            qty_damaged: d.damaged,
            qty_lost: d.lost,
          };
        }),
      });
    },
    onSuccess: (b) => {
      toast.success(`Batch ${b.batch_number} returned`);
      qc.invalidateQueries({ queryKey: ["laundry-batch", batch.id] });
      onDone();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 bg-background/85 backdrop-blur border-b border-border">
        <div className="px-4 py-3 max-w-3xl mx-auto flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted"><ArrowLeft className="h-4 w-4" /></button>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Confirm Return</div>
            <div className="font-display text-base leading-tight">{batch.batch_number}</div>
          </div>
        </div>
      </div>

      <div className="px-4 py-6 max-w-3xl mx-auto space-y-4">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-500">
          All quantities default to <b>fully returned OK</b>. Tap a linen row only if something was short, damaged or lost.
        </div>

        <div className="luxe-card rounded-lg overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
            <div className="col-span-5">Linen</div>
            <div className="col-span-2 text-right">Sent</div>
            <div className="col-span-2 text-right">OK</div>
            <div className="col-span-3 text-right">Issues</div>
          </div>
          {lines.map((l) => {
            const d = draft[l.id] ?? { ok: l.qty_sent, short: 0, damaged: 0, lost: 0 };
            const issues = d.short + d.damaged + d.lost;
            const isOpen = !!expanded[l.id];
            return (
              <div key={l.id} className="border-b border-border/60 last:border-0">
                <button
                  onClick={() => setExpanded((e) => ({ ...e, [l.id]: !e[l.id] }))}
                  className="w-full grid grid-cols-12 items-center gap-2 px-4 py-2.5 text-sm text-left hover:bg-muted/10"
                >
                  <div className="col-span-5">{l.linen_name_at_time}</div>
                  <div className="col-span-2 text-right text-muted-foreground">{l.qty_sent}</div>
                  <div className={cn("col-span-2 text-right font-medium", issues > 0 ? "text-emerald-500" : "text-gold")}>{d.ok}</div>
                  <div className={cn("col-span-3 text-right text-xs", issues > 0 ? "text-red-500" : "text-muted-foreground")}>
                    {issues > 0 ? `${issues} issue${issues === 1 ? "" : "s"}` : "—"}
                  </div>
                </button>
                {isOpen && (
                  <div className="grid grid-cols-3 gap-2 px-4 pb-3">
                    {(["short", "damaged", "lost"] as const).map((b) => (
                      <div key={b}>
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{b}</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={l.qty_sent}
                          value={d[b]}
                          onChange={(e) => setBucket(l.id, b, Number(e.target.value))}
                          className="w-full bg-input/60 border border-border rounded-md px-2 py-1 text-right text-sm mt-0.5"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-muted/20 text-xs font-medium">
            <div className="col-span-5">Totals</div>
            <div className="col-span-2 text-right">{totals.sent}</div>
            <div className="col-span-2 text-right text-gold">{totals.ok}</div>
            <div className="col-span-3 text-right text-muted-foreground">
              {totals.short}s · {totals.dmg}d · {totals.lost}l
            </div>
          </div>
        </div>

        {anyShortfall && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-500">
            {totals.short > 0 && <>Short items ({totals.short}) will roll forward as <b>Previous Missing</b> in the next pickup. </>}
            {(totals.dmg + totals.lost) > 0 && <>Damaged/Lost linen will be written off.</>}
          </div>
        )}

        <div className="luxe-card rounded-lg p-3 space-y-3">
          <PhotoPicker
            label="Return Photos (optional)"
            files={photoFiles}
            onFilesChange={setPhotoFiles}
          />
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Return Remarks</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm mt-1"
            />
          </div>
        </div>

        <button
          onClick={() => confirmMut.mutate()}
          disabled={confirmMut.isPending || totals.unaccounted !== 0}
          className="w-full py-3 rounded-md bg-gold text-charcoal font-medium disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {confirmMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirm Return
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────  Edit Return (admin/owner)  ──────────────── */

function EditReturnScreen({ batch, lines, me, onClose, onDone }: {
  batch: LaundryBatchRow;
  lines: LaundryBatchLineRow[];
  me: { id: string; name: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, { ok: number; short: number; damaged: number; lost: number }>>(() => {
    const d: Record<string, { ok: number; short: number; damaged: number; lost: number }> = {};
    for (const l of lines) d[l.id] = { ok: l.qty_returned_ok, short: l.qty_short, damaged: l.qty_damaged, lost: l.qty_lost };
    return d;
  });
  const [reason, setReason] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!me.id) throw new Error("Not signed in");
      await editReturnedBatchLines(
        batch.id,
        lines.map((l) => ({
          line_id: l.id,
          qty_returned_ok: Math.max(0, Math.floor(draft[l.id]?.ok ?? 0)),
          qty_short: Math.max(0, Math.floor(draft[l.id]?.short ?? 0)),
          qty_damaged: Math.max(0, Math.floor(draft[l.id]?.damaged ?? 0)),
          qty_lost: Math.max(0, Math.floor(draft[l.id]?.lost ?? 0)),
        })),
        me,
        reason || null,
      );
    },
    onSuccess: () => { toast.success("Return counts corrected"); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });

  const setCell = (id: string, k: "ok" | "short" | "damaged" | "lost", v: number) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id], [k]: Math.max(0, Math.floor(v || 0)) } }));

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 bg-background/85 backdrop-blur border-b border-border">
        <div className="px-4 py-3 max-w-3xl mx-auto flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted"><ArrowLeft className="h-4 w-4" /></button>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Correct Return</div>
            <div className="font-display text-base leading-tight truncate">{batch.batch_number}</div>
          </div>
        </div>
      </div>
      <div className="px-4 py-6 max-w-3xl mx-auto space-y-4">
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-500">
          Corrections only fix the counting record. OK + Short + Dmg + Lost must equal Sent per linen. The change is logged in Activity Log.
        </div>
        <div className="space-y-2">
          {lines.map((l) => {
            const d = draft[l.id];
            const total = d.ok + d.short + d.damaged + d.lost;
            const ok = total === l.qty_sent;
            return (
              <div key={l.id} className="luxe-card rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">{l.linen_name_at_time}</div>
                  <div className={cn("text-[11px] tabular-nums", ok ? "text-emerald-500" : "text-red-500")}>
                    {total}/{l.qty_sent}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {(["ok", "short", "damaged", "lost"] as const).map((k) => (
                    <div key={k}>
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</label>
                      <input type="number" inputMode="numeric" min={0} value={d[k]}
                        onChange={(e) => setCell(l.id, k, Number(e.target.value))}
                        className="w-full bg-input/60 border border-border rounded-md px-2 py-1 text-sm mt-0.5" />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Reason for correction</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Miscounted at pickup — recount by supervisor"
            className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm mt-1" />
        </div>
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="w-full py-3 rounded-md bg-gold text-charcoal font-medium disabled:opacity-50 flex items-center justify-center gap-2">
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          <Save className="h-4 w-4" /> Save Corrections
        </button>
      </div>
    </div>
  );
}
