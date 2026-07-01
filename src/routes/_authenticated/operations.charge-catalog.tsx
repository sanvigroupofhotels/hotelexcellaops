import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, X, Loader2, Trash2, Boxes } from "lucide-react";
import { AdminOnly } from "@/components/admin-only";
import {
  listChargeCatalog, createChargeCatalog, updateChargeCatalog, deleteChargeCatalog,
  type ChargeCatalogRow,
} from "@/lib/charge-catalog-api";
import { listInventoryItems } from "@/lib/inventory-items-api";

export const Route = createFileRoute("/_authenticated/operations/charge-catalog")({ component: ChargeCatalogPage });

const inputCls = "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40";

function ChargeCatalogPage() {
  return (
    <AdminOnly>
      <Inner />
    </AdminOnly>
  );
}

function Inner() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ChargeCatalogRow | null>(null);
  const [creating, setCreating] = useState(false);
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["charge-catalog"], queryFn: () => listChargeCatalog() });

  const toggle = useMutation({
    mutationFn: (r: ChargeCatalogRow) => updateChargeCatalog(r.id, { active: !r.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["charge-catalog"] }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground max-w-xl">
          The Charge Catalog is the single source of truth for billable items. Inventory items can link
          to a catalog entry to auto-deduct stock when the charge is added to a bill (Shipment 2).
        </p>
        <button onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-3 py-2 text-xs font-medium">
          <Plus className="h-3.5 w-3.5" /> Charge
        </button>
      </div>

      {isLoading ? (
        <div className="luxe-card rounded-xl p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : (
        <div className="luxe-card rounded-xl divide-y divide-border/40">
          {rows.map((r) => (
            <button key={r.id} onClick={() => setEditing(r)}
              className="w-full text-left p-3 flex items-center gap-3 hover:bg-muted/30">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium flex items-center gap-1.5">
                  {r.label}
                  {r.inventory_item_id && <Boxes className="h-3 w-3 text-gold" aria-label="Auto-consume linked" />}
                  {!r.active && <span className="text-[10px] text-muted-foreground ml-1">(inactive)</span>}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  key: {r.key} · sort {r.sort_order}{r.taxable && " · taxable"}
                  {r.inventory_item_id && ` · deducts ${Number(r.auto_consume_qty || 1)} / unit`}
                </div>
              </div>
              <div className="text-sm tabular-nums">₹{Number(r.default_price).toLocaleString("en-IN")}</div>
              <span onClick={(e) => { e.stopPropagation(); toggle.mutate(r); }}
                className={`text-[10px] px-2 py-0.5 rounded border cursor-pointer ${r.active ? "border-emerald-500/40 text-emerald-500" : "border-border text-muted-foreground"}`}>
                {r.active ? "ON" : "OFF"}
              </span>
            </button>
          ))}
        </div>
      )}

      {creating && <CatalogDialog onClose={() => setCreating(false)} />}
      {editing && <CatalogDialog row={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CatalogDialog({ row, onClose }: { row?: ChargeCatalogRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState(row?.label ?? "");
  const [key, setKey] = useState(row?.key ?? "");
  const [price, setPrice] = useState(String(row?.default_price ?? 0));
  const [sort, setSort] = useState(String(row?.sort_order ?? 100));
  const [taxable, setTaxable] = useState(row?.taxable ?? false);
  const [active, setActive] = useState(row?.active ?? true);
  const [invItemId, setInvItemId] = useState<string>(row?.inventory_item_id ?? "");
  const [autoQty, setAutoQty] = useState(String(row?.auto_consume_qty ?? 1));
  const { data: items = [] } = useQuery({ queryKey: ["inventory-items", "active"], queryFn: () => listInventoryItems({ activeOnly: true }) });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        key: key || label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        label, default_price: Number(price) || 0, sort_order: Number(sort) || 100,
        taxable, active,
        inventory_item_id: invItemId || null,
        auto_consume_qty: invItemId ? Math.max(Number(autoQty) || 1, 0.0001) : 1,
      };
      if (row) await updateChargeCatalog(row.id, payload);
      else await createChargeCatalog(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["charge-catalog"] });
      toast.success(row ? "Saved" : "Added"); onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });
  const del = useMutation({
    mutationFn: () => deleteChargeCatalog(row!.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["charge-catalog"] }); toast.success("Deleted"); onClose(); },
    onError: (e: any) => toast.error(e.message ?? "Delete failed"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full md:max-w-md max-h-[92vh] flex flex-col bg-card border border-border rounded-t-2xl md:rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-display text-base md:text-lg">{row ? "Edit Charge" : "New Charge"}</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 grid gap-3 overflow-y-auto">
          <div><div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Label *</div>
            <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          <div><div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Key (slug)</div>
            <input className={inputCls} value={key} onChange={(e) => setKey(e.target.value)} disabled={!!row} placeholder="auto from label" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Default Price</div>
              <input className={inputCls} type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            <div><div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Sort</div>
              <input className={inputCls} type="number" value={sort} onChange={(e) => setSort(e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} /> Taxable</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center gap-2">
          {row && (
            <button onClick={() => { if (confirm("Delete this charge?")) del.mutate(); }} disabled={del.isPending}
              className="inline-flex items-center gap-1.5 border border-destructive/40 text-destructive rounded-md px-3 py-2 text-xs">
              {del.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-2 text-xs">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || !label.trim()}
            className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-4 py-2 text-xs font-medium disabled:opacity-60">
            {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
