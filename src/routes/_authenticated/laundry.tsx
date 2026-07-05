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
import { Loader2, ArrowLeft, Truck, ClipboardList, Camera, AlertTriangle, ChevronRight, XCircle, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { getBusinessDate } from "@/lib/night-audit-api";
import { listVendors, type VendorRow } from "@/lib/vendors-api";
import {
  previewPickup, createBatch, listBatches, cancelBatch, getBatch, confirmReturn, signedLaundryPhotoUrl,
  type LaundryBatchRow, type LaundryBatchLineRow, type PickupPreviewRow,
} from "@/lib/laundry-batches-api";
import { useCurrentStaff } from "@/hooks/use-current-staff";
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
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [sent, setSent] = useState<Record<string, number>>({});

  // Default vendor to the first laundry vendor once list arrives.
  useEffect(() => {
    if (!vendorId && laundryVendors.length > 0) setVendorId(laundryVendors[0].id);
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
        slipPhotoFile: photoFile,
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
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Camera className="h-3 w-3" /> Pickup Slip Photo <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs mt-1"
            />
            {photoFile && <div className="text-[10px] text-emerald-500 mt-1">Ready: {photoFile.name}</div>}
          </div>
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
  const [pickupUrl, setPickupUrl] = useState<string | null>(null);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (data?.batch.pickup_slip_photo_path) {
        const u = await signedLaundryPhotoUrl(data.batch.pickup_slip_photo_path);
        if (alive) setPickupUrl(u);
      }
      if (data?.batch.return_photo_path) {
        const u = await signedLaundryPhotoUrl(data.batch.return_photo_path);
        if (alive) setReturnUrl(u);
      }
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

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 bg-background/85 backdrop-blur border-b border-border">
        <div className="px-4 py-3 max-w-3xl mx-auto flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted"><ArrowLeft className="h-4 w-4" /></button>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Batch</div>
            <div className="font-display text-base leading-tight">{batch.batch_number}</div>
          </div>
          <span className={cn(
            "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full",
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

        <div className="luxe-card rounded-lg overflow-hidden">
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
        </div>

        {(batch.pickup_remarks || batch.return_remarks) && (
          <div className="luxe-card rounded-lg p-3 space-y-2 text-xs">
            {batch.pickup_remarks && <div><b>Pickup remarks:</b> {batch.pickup_remarks}</div>}
            {batch.return_remarks && <div><b>Return remarks:</b> {batch.return_remarks}</div>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <PhotoTile label="Pickup Slip" url={pickupUrl} />
          <PhotoTile label="Return Bag" url={returnUrl} />
        </div>

        <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
          Return workflow (OK / Short / Damaged / Lost + return photo) ships next.
          For now, batches in "sent" state can be cancelled if pickup was recorded
          in error — this restores the queue.
        </div>

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
    </div>
  );
}

function PhotoTile({ label, url }: { label: string; url: string | null }) {
  return (
    <div className="luxe-card rounded-lg overflow-hidden aspect-square flex items-center justify-center bg-muted/20">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="w-full h-full">
          <img src={url} alt={label} className="w-full h-full object-cover" />
        </a>
      ) : (
        <div className="flex flex-col items-center text-muted-foreground text-[10px] uppercase tracking-wider">
          <ImageIcon className="h-6 w-6 mb-1 opacity-60" />
          {label}
        </div>
      )}
    </div>
  );
}
