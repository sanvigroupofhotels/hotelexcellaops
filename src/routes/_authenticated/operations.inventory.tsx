import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, Phone, AlertTriangle, Package, History as HistoryIcon, Search,
  ArrowDown, ArrowUp, X, Loader2, Trash2, Camera, MoreVertical, Layers, ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMasterData } from "@/hooks/use-master-data";
import { useUserRole } from "@/hooks/use-role";
import { listVendors, type VendorRow } from "@/lib/vendors-api";
import { listChargeCatalog, type ChargeCatalogRow } from "@/lib/charge-catalog-api";
import {
  listInventoryItems, createInventoryItem, updateInventoryItem, deleteInventoryItem,
  uploadItemPhoto, removeItemPhoto, signedPhotoUrl, type InventoryItemRow,
} from "@/lib/inventory-items-api";
import {
  listMovements, stockIn, stockOut, recordBulkMovement, formatReason, type InventoryMovementRow,
} from "@/lib/inventory-movements";

export const Route = createFileRoute("/_authenticated/operations/inventory")({ component: InventoryPage });

type Tab = "low" | "items" | "history";

const inputCls = "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40";
const labelCls = "text-[11px] uppercase tracking-wider text-muted-foreground";

function InventoryPage() {
  const [tab, setTab] = useState<Tab>("low");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<InventoryItemRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [movementFor, setMovementFor] = useState<{ item: InventoryItemRow; kind: "in" | "out" } | null>(null);
  const [bulk, setBulk] = useState<null | "in" | "out">(null);
  const [reconcile, setReconcile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["inventory-items"], queryFn: () => listInventoryItems(),
  });
  const { data: vendors = [] } = useQuery({ queryKey: ["vendors", { active: true }], queryFn: () => listVendors({ activeOnly: true }) });
  const vendorMap = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);

  const lowItems = items.filter((i) => i.active && Number(i.current_stock) <= Number(i.minimum_stock));
  const filtered = items.filter((i) =>
    !search || i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.category_value ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      {/* Sub-nav */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 bg-card/60 border border-border rounded-md p-1 overflow-x-auto">
          <TabBtn active={tab === "low"} onClick={() => setTab("low")}>
            <AlertTriangle className="h-3.5 w-3.5" /> Low Stock
            {lowItems.length > 0 && <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold">{lowItems.length}</span>}
          </TabBtn>
          <TabBtn active={tab === "items"} onClick={() => setTab("items")}><Package className="h-3.5 w-3.5" /> Items</TabBtn>
          <TabBtn active={tab === "history"} onClick={() => setTab("history")}><HistoryIcon className="h-3.5 w-3.5" /> History</TabBtn>
        </div>
        <div className="flex items-center gap-1 relative">
          <button onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-3 py-2 text-xs font-medium whitespace-nowrap">
            <Plus className="h-3.5 w-3.5" /> Item
          </button>
          <button onClick={() => setMenuOpen((v) => !v)} title="More"
            className="h-8 w-8 rounded-md border border-border text-muted-foreground inline-flex items-center justify-center">
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-[110%] z-40 min-w-[200px] bg-card border border-border rounded-md shadow-2xl p-1 text-sm">
                <button onClick={() => { setBulk("in"); setMenuOpen(false); }} className="w-full text-left px-3 py-2 rounded hover:bg-muted/40 flex items-center gap-2"><Layers className="h-4 w-4 text-gold" /> Bulk Stock In</button>
                <button onClick={() => { setBulk("out"); setMenuOpen(false); }} className="w-full text-left px-3 py-2 rounded hover:bg-muted/40 flex items-center gap-2"><Layers className="h-4 w-4" /> Bulk Stock Out</button>
                <button onClick={() => { setReconcile(true); setMenuOpen(false); }} className="w-full text-left px-3 py-2 rounded hover:bg-muted/40 flex items-center gap-2"><ClipboardCheck className="h-4 w-4" /> Inventory Reconciliation</button>
              </div>
            </>
          )}
        </div>
      </div>

      {tab === "low" && (
        <LowStockList items={lowItems} vendorMap={vendorMap} loading={isLoading}
          onStockIn={(item) => setMovementFor({ item, kind: "in" })} onOpen={(item) => setEditing(item)} />
      )}

      {tab === "items" && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…"
              className={cn(inputCls, "pl-9")} />
          </div>
          <ItemsList items={filtered} vendorMap={vendorMap} loading={isLoading}
            onOpen={(item) => setEditing(item)}
            onStockIn={(item) => setMovementFor({ item, kind: "in" })}
            onStockOut={(item) => setMovementFor({ item, kind: "out" })} />
        </>
      )}

      {tab === "history" && <HistoryFeed items={items} />}

      {creating && <ItemDialog onClose={() => setCreating(false)} />}
      {editing && (
        <ItemDialog item={editing} onClose={() => setEditing(null)}
          onStockIn={() => { setMovementFor({ item: editing, kind: "in" }); setEditing(null); }}
          onStockOut={() => { setMovementFor({ item: editing, kind: "out" }); setEditing(null); }} />
      )}
      {movementFor && (
        <MovementDialog item={movementFor.item} kind={movementFor.kind}
          vendors={vendors} onClose={() => setMovementFor(null)} />
      )}
      {bulk && <BulkMovementDialog kind={bulk} items={items.filter((i) => i.active)} vendors={vendors} onClose={() => setBulk(null)} />}
      {reconcile && <ReconciliationDialog items={items.filter((i) => i.active)} onClose={() => setReconcile(false)} />}
    </div>
  );
}

function TabBtn({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md whitespace-nowrap transition",
        active ? "bg-gold-soft text-gold border border-gold/30" : "text-muted-foreground hover:text-foreground",
      )}>{children}</button>
  );
}

/* -------------------------------------------------------------- Low Stock */

function LowStockList({ items, vendorMap, loading, onStockIn, onOpen }: {
  items: InventoryItemRow[]; vendorMap: Map<string, VendorRow>; loading: boolean;
  onStockIn: (i: InventoryItemRow) => void; onOpen: (i: InventoryItemRow) => void;
}) {
  if (loading) return <div className="luxe-card rounded-xl p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>;
  if (items.length === 0) {
    return <div className="luxe-card rounded-xl p-10 text-center text-sm text-muted-foreground">All items are above their minimum stock. 🎉</div>;
  }
  return (
    <div className="space-y-2">
      {items.map((i) => {
        const v = i.preferred_vendor_id ? vendorMap.get(i.preferred_vendor_id) : null;
        return (
          <div key={i.id} className="luxe-card rounded-xl p-3.5 flex flex-col gap-2">
            <button onClick={() => onOpen(i)} className="text-left">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                <div className="font-medium text-sm">{i.name}</div>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                <span className="text-destructive font-semibold tabular-nums">{Number(i.current_stock)}</span>
                {" / "}{Number(i.minimum_stock)} {i.unit}
              </div>
            </button>
            {v ? (
              <div className="text-[11px] text-muted-foreground flex items-center justify-between gap-2 flex-wrap">
                <span className="truncate">{v.name} · {v.contact_person}</span>
                <span className="tabular-nums">{v.phone}</span>
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground italic">No preferred vendor</div>
            )}
            <div className="flex items-center gap-2">
              {v && (
                <a href={`tel:${v.phone}`} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-gold/40 text-gold px-3 py-2 text-xs">
                  <Phone className="h-3.5 w-3.5" /> Call
                </a>
              )}
              <button onClick={() => onStockIn(i)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 gold-gradient text-charcoal rounded-md px-3 py-2 text-xs font-medium">
                <ArrowDown className="h-3.5 w-3.5" /> Stock In
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- Items */

function ItemsList({ items, vendorMap, loading, onOpen, onStockIn, onStockOut }: {
  items: InventoryItemRow[]; vendorMap: Map<string, VendorRow>; loading: boolean;
  onOpen: (i: InventoryItemRow) => void;
  onStockIn: (i: InventoryItemRow) => void;
  onStockOut: (i: InventoryItemRow) => void;
}) {
  if (loading) return <div className="luxe-card rounded-xl p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>;
  if (items.length === 0) {
    return <div className="luxe-card rounded-xl p-10 text-center text-sm text-muted-foreground">No items yet. Tap "+ Item" to add one.</div>;
  }
  return (
    <div className="space-y-2">
      {items.map((i) => {
        const v = i.preferred_vendor_id ? vendorMap.get(i.preferred_vendor_id) : null;
        const low = Number(i.current_stock) <= Number(i.minimum_stock);
        return (
          <div key={i.id} className="luxe-card rounded-xl p-3.5 flex items-center gap-3">
            <ItemThumb path={i.photo_path} />
            <button onClick={() => onOpen(i)} className="flex-1 text-left min-w-0">
              <div className="text-sm font-medium truncate flex items-center gap-1.5">
                {low && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                {i.name}
                {!i.active && <span className="text-[10px] text-muted-foreground">(inactive)</span>}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                <span className={cn("tabular-nums", low && "text-destructive font-semibold")}>{Number(i.current_stock)}</span>
                {" / "}{Number(i.minimum_stock)} {i.unit}
                {v && <> · {v.name}</>}
              </div>
            </button>
            <div className="flex flex-col gap-1">
              <button onClick={() => onStockIn(i)} title="Stock In"
                className="h-8 w-8 rounded-md border border-gold/40 text-gold inline-flex items-center justify-center">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => onStockOut(i)} title="Stock Out"
                className="h-8 w-8 rounded-md border border-border text-muted-foreground inline-flex items-center justify-center">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ItemThumb({ path }: { path: string | null }) {
  const { data: url } = useQuery({
    queryKey: ["inv-photo", path], queryFn: () => signedPhotoUrl(path), enabled: !!path, staleTime: 4 * 60_000,
  });
  return (
    <div className="h-12 w-12 rounded-md bg-muted/40 border border-border overflow-hidden shrink-0 flex items-center justify-center">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <Package className="h-5 w-5 text-muted-foreground" />}
    </div>
  );
}

/* --------------------------------------------------------------- History */

function HistoryFeed({ items }: { items: InventoryItemRow[] }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["inv-movements", "all"], queryFn: () => listMovements({ limit: 200 }),
  });
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  if (isLoading) return <div className="luxe-card rounded-xl p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>;
  if (rows.length === 0) return <div className="luxe-card rounded-xl p-10 text-center text-sm text-muted-foreground">No movements yet.</div>;
  return (
    <div className="luxe-card rounded-xl divide-y divide-border/40">
      {rows.map((m) => <MovementRow key={m.id} m={m} itemName={itemMap.get(m.item_id)?.name ?? "—"} />)}
    </div>
  );
}

function MovementRow({ m, itemName }: { m: InventoryMovementRow; itemName: string }) {
  const positive = Number(m.delta) > 0;
  return (
    <div className="p-3 flex items-start gap-3">
      <div className={cn(
        "h-8 w-8 rounded-md inline-flex items-center justify-center shrink-0",
        positive ? "bg-emerald-500/15 text-emerald-500" : "bg-destructive/15 text-destructive",
      )}>
        {positive ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">
          <span className="font-medium">{itemName}</span>
          <span className={cn("ml-2 font-semibold tabular-nums", positive ? "text-emerald-500" : "text-destructive")}>
            {positive ? "+" : ""}{Number(m.delta)}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {formatReason(m.reason)} · {m.actor_name ?? "—"} · {new Date(m.occurred_at).toLocaleString()}
        </div>
        {m.notes && <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{m.notes}</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- Item Dialog */

function ItemDialog({ item, onClose, onStockIn, onStockOut }: {
  item?: InventoryItemRow; onClose: () => void;
  onStockIn?: () => void; onStockOut?: () => void;
}) {
  const qc = useQueryClient();
  const { isAdmin, isOwner } = useUserRole();
  const canDelete = isAdmin || isOwner;
  const { values: categoryValues, labels: categoryLabels } = useMasterData("inventory_category");
  const { data: vendors = [] } = useQuery({ queryKey: ["vendors", { active: true }], queryFn: () => listVendors({ activeOnly: true }) });
  const { data: catalog = [] } = useQuery({ queryKey: ["charge-catalog", { active: true }], queryFn: () => listChargeCatalog({ activeOnly: true }) });

  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "piece");
  const [category, setCategory] = useState(item?.category_value ?? "");
  const [vendor, setVendor] = useState(item?.preferred_vendor_id ?? "");
  const [minimum, setMinimum] = useState(String(item?.minimum_stock ?? 0));
  const [active, setActive] = useState(item?.active ?? true);
  const [autoKey, setAutoKey] = useState(item?.auto_consume_catalog_key ?? "");
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const { data: photoUrl } = useQuery({
    queryKey: ["inv-photo", item?.photo_path], queryFn: () => signedPhotoUrl(item?.photo_path ?? null),
    enabled: !!item?.photo_path, staleTime: 4 * 60_000,
  });

  const recent = useQuery({
    queryKey: ["inv-movements", item?.id], queryFn: () => listMovements({ item_id: item!.id, limit: 25 }),
    enabled: !!item,
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name, unit, category_value: category || null,
        preferred_vendor_id: vendor || null,
        minimum_stock: Number(minimum) || 0,
        auto_consume_catalog_key: autoKey || null,
        active,
      };
      let id = item?.id;
      if (!id) {
        const created = await createInventoryItem(payload);
        id = created.id;
      } else {
        await updateInventoryItem(id, payload);
      }
      if (photoFile && id) await uploadItemPhoto(id, photoFile);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory-items"] });
      toast.success(item ? "Item saved" : "Item created");
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  const del = useMutation({
    mutationFn: () => deleteInventoryItem(item!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory-items"] });
      toast.success("Item deleted");
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Delete failed"),
  });

  return (
    <DialogShell title={item ? "Edit Item" : "New Item"} onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Photo">
          <div className="flex items-center gap-3">
            <div className="h-16 w-16 rounded-md bg-muted/40 border border-border overflow-hidden flex items-center justify-center shrink-0">
              {photoFile ? (
                <img src={URL.createObjectURL(photoFile)} alt="" className="h-full w-full object-cover" />
              ) : photoUrl ? (
                <img src={photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Camera className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <label className="inline-flex items-center gap-1.5 border border-border rounded-md px-3 py-2 text-xs cursor-pointer hover:bg-muted/40">
              <Camera className="h-3.5 w-3.5" /> {item?.photo_path || photoFile ? "Change" : "Upload"}
              <input type="file" accept="image/*" className="hidden"
                onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
            </label>
            {item?.photo_path && !photoFile && (
              <button onClick={async () => {
                await removeItemPhoto(item.id);
                qc.invalidateQueries({ queryKey: ["inv-photo", item.photo_path] });
                qc.invalidateQueries({ queryKey: ["inventory-items"] });
              }}
                className="text-[11px] text-muted-foreground hover:text-destructive">Remove</button>
            )}
          </div>
        </Field>

        <Field label="Name *">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Water Bottle 1L" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit">
            <input className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="bottle, sachet…" />
          </Field>
          <Field label="Min Stock">
            <input className={inputCls} type="number" inputMode="numeric" value={minimum} onChange={(e) => setMinimum(e.target.value)} />
          </Field>
        </div>

        <Field label="Category">
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">— None —</option>
            {categoryValues.map((v) => <option key={v} value={v}>{categoryLabels[v] ?? v}</option>)}
          </select>
        </Field>

        <Field label="Preferred Vendor">
          <select className={inputCls} value={vendor} onChange={(e) => setVendor(e.target.value)}>
            <option value="">— None —</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>

        <Field label="Auto-consume when this charge is added">
          <select className={inputCls} value={autoKey} onChange={(e) => setAutoKey(e.target.value)}>
            <option value="">— Manual only —</option>
            {catalog.map((c: ChargeCatalogRow) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <p className="text-[10px] text-muted-foreground mt-1">Legacy per-item mapping. Prefer setting the Inventory link from <b>Operations → Charge Catalog</b> — that's the active auto-consume path.</p>
        </Field>

        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>

        {item && (
          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between mb-2">
              <div className={labelCls}>Current Stock</div>
              <div className="text-lg font-display tabular-nums">{Number(item.current_stock)} {item.unit}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={onStockIn} className="flex-1 inline-flex items-center justify-center gap-1.5 gold-gradient text-charcoal rounded-md px-3 py-2 text-xs font-medium">
                <ArrowDown className="h-3.5 w-3.5" /> Stock In
              </button>
              <button onClick={onStockOut} className="flex-1 inline-flex items-center justify-center gap-1.5 border border-border rounded-md px-3 py-2 text-xs">
                <ArrowUp className="h-3.5 w-3.5" /> Stock Out
              </button>
            </div>
            <div className="mt-4">
              <div className={cn(labelCls, "mb-1.5")}>Recent Movements</div>
              <div className="border border-border rounded-md max-h-56 overflow-y-auto divide-y divide-border/40">
                {(recent.data ?? []).length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">No movements yet.</div>
                )}
                {(recent.data ?? []).map((m) => <MovementRow key={m.id} m={m} itemName={item.name} />)}
              </div>
            </div>
          </div>
        )}
      </div>

      <DialogFooter>
        {item && canDelete && (
          <button onClick={() => { if (confirm("Delete this item? Movement history will be removed.")) del.mutate(); }}
            disabled={del.isPending}
            className="inline-flex items-center gap-1.5 border border-destructive/40 text-destructive rounded-md px-3 py-2 text-xs">
            {del.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
          </button>
        )}
        <div className="flex-1" />
        <button onClick={onClose} className="px-3 py-2 text-xs">Cancel</button>
        <button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}
          className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-4 py-2 text-xs font-medium disabled:opacity-60">
          {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
        </button>
      </DialogFooter>
    </DialogShell>
  );
}

/* ------------------------------------------------------ Movement Dialog */

function MovementDialog({ item, kind, vendors, onClose }: {
  item: InventoryItemRow; kind: "in" | "out";
  vendors: VendorRow[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [vendorId, setVendorId] = useState(item.preferred_vendor_id ?? "");
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const q = Number(qty);
      if (!(q > 0)) throw new Error("Quantity must be greater than zero");
      if (kind === "in") {
        await stockIn({
          item_id: item.id, quantity: q,
          unit_cost: unitCost ? Number(unitCost) : null,
          vendor_id: vendorId || null,
          notes: notes || null,
        });
      } else {
        await stockOut({ item_id: item.id, quantity: q, notes: notes || null });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory-items"] });
      qc.invalidateQueries({ queryKey: ["inv-movements"] });
      toast.success(kind === "in" ? "Stock In recorded" : "Stock Out recorded");
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <DialogShell title={`${kind === "in" ? "Stock In" : "Stock Out"} · ${item.name}`} onClose={onClose}>
      <div className="grid gap-3">
        <div className="text-xs text-muted-foreground">
          Current: <span className="tabular-nums font-semibold text-foreground">{Number(item.current_stock)}</span> {item.unit}
        </div>
        <Field label={`Quantity (${item.unit})`}>
          <input className={inputCls} type="number" inputMode="decimal" autoFocus
            value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
        </Field>
        {kind === "in" && (
          <>
            <Field label="Vendor">
              <select className={inputCls} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">— None —</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </Field>
            <Field label="Unit Cost (optional)">
              <input className={inputCls} type="number" inputMode="decimal"
                value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0" />
            </Field>
          </>
        )}
        <Field label="Notes (optional)">
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <DialogFooter>
        <button onClick={onClose} className="px-3 py-2 text-xs">Cancel</button>
        <button onClick={() => save.mutate()} disabled={save.isPending || !qty}
          className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-4 py-2 text-xs font-medium disabled:opacity-60">
          {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
        </button>
      </DialogFooter>
    </DialogShell>
  );
}

/* ------------------------------------------------------------ primitives */

function DialogShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full md:max-w-lg max-h-[92vh] flex flex-col bg-card border border-border rounded-t-2xl md:rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-display text-base md:text-lg">{title}</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3 border-t border-border flex items-center gap-2 flex-wrap mt-0">{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><div className={labelCls}>{label}</div>{children}</div>;
}

/* ---------------------------------------------------- Bulk Stock In / Out */

type BulkLine = { key: string; item_id: string; quantity: string; unit_cost: string };

function BulkMovementDialog({ kind, items, vendors, onClose }: {
  kind: "in" | "out"; items: InventoryItemRow[]; vendors: VendorRow[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [vendorId, setVendorId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<BulkLine[]>([
    { key: crypto.randomUUID(), item_id: "", quantity: "", unit_cost: "" },
  ]);

  const update = (key: string, patch: Partial<BulkLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = () => setLines((ls) => [...ls, { key: crypto.randomUUID(), item_id: "", quantity: "", unit_cost: "" }]);
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const save = useMutation({
    mutationFn: async () => {
      const clean = lines
        .filter((l) => l.item_id && Number(l.quantity) > 0)
        .map((l) => ({
          item_id: l.item_id,
          quantity: Number(l.quantity),
          unit_cost: kind === "in" && l.unit_cost ? Number(l.unit_cost) : null,
        }));
      if (!clean.length) throw new Error("Add at least one item with a quantity");
      await recordBulkMovement({
        reason: kind === "in" ? "stock_in" : "stock_out",
        vendor_id: kind === "in" ? (vendorId || null) : null,
        notes: kind === "out" ? (reason || null) : null,
        lines: clean,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory-items"] });
      qc.invalidateQueries({ queryKey: ["inv-movements"] });
      toast.success(kind === "in" ? "Bulk Stock In recorded" : "Bulk Stock Out recorded");
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  return (
    <DialogShell title={kind === "in" ? "Bulk Stock In" : "Bulk Stock Out"} onClose={onClose}>
      <div className="grid gap-3">
        {kind === "in" ? (
          <Field label="Vendor">
            <select className={inputCls} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">— None —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Reason / Notes">
            <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Monthly housekeeping refill" />
          </Field>
        )}

        <div className="space-y-2">
          <div className={labelCls}>Items</div>
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-[1fr_80px_80px_28px] gap-1.5 items-center">
              <select className={inputCls} value={l.item_id} onChange={(e) => update(l.key, { item_id: e.target.value })}>
                <option value="">— Select item —</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <input className={inputCls} type="number" inputMode="decimal" placeholder="Qty"
                value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
              {kind === "in" ? (
                <input className={inputCls} type="number" inputMode="decimal" placeholder="₹/unit"
                  value={l.unit_cost} onChange={(e) => update(l.key, { unit_cost: e.target.value })} />
              ) : <div />}
              <button onClick={() => remove(l.key)}
                className="h-9 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-destructive"
                title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <button onClick={add} className="text-xs text-gold hover:underline">+ Add item</button>
        </div>
      </div>
      <DialogFooter>
        <div className="flex-1" />
        <button onClick={onClose} className="px-3 py-2 text-xs">Cancel</button>
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-4 py-2 text-xs font-medium disabled:opacity-60">
          {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
        </button>
      </DialogFooter>
    </DialogShell>
  );
}

/* --------------------------------------------------- Inventory Reconciliation */

function ReconciliationDialog({ items, onClose }: { items: InventoryItemRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

  const diffs = items
    .map((i) => {
      const raw = counts[i.id];
      if (raw === undefined || raw === "") return null;
      const counted = Number(raw);
      if (!Number.isFinite(counted)) return null;
      const delta = counted - Number(i.current_stock);
      return { item: i, counted, delta };
    })
    .filter((x): x is { item: InventoryItemRow; counted: number; delta: number } => !!x && x.delta !== 0);

  const save = useMutation({
    mutationFn: async () => {
      if (!diffs.length) throw new Error("Enter counts that differ from current stock");
      await recordBulkMovement({
        reason: "reconciliation_adjust",
        notes: notes || "Inventory Reconciliation",
        lines: diffs.map((d) => ({ item_id: d.item.id, quantity: d.delta, notes: `Counted ${d.counted} (was ${d.item.current_stock})` })),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory-items"] });
      qc.invalidateQueries({ queryKey: ["inv-movements"] });
      toast.success(`Reconciled ${diffs.length} item${diffs.length === 1 ? "" : "s"}`);
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  return (
    <DialogShell title="Inventory Reconciliation" onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Notes (optional)">
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Month-end count · 30 Jun" />
        </Field>
        <div className="border border-border rounded-md divide-y divide-border/40 max-h-[50vh] overflow-y-auto">
          {items.map((i) => {
            const raw = counts[i.id] ?? "";
            const counted = raw === "" ? null : Number(raw);
            const delta = counted == null || !Number.isFinite(counted) ? null : counted - Number(i.current_stock);
            return (
              <div key={i.id} className="p-2.5 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{i.name}</div>
                  <div className="text-[11px] text-muted-foreground">Current: <span className="tabular-nums">{Number(i.current_stock)}</span> {i.unit}</div>
                </div>
                <input className={cn(inputCls, "w-24")} type="number" inputMode="decimal" placeholder="Counted"
                  value={raw} onChange={(e) => setCounts((c) => ({ ...c, [i.id]: e.target.value }))} />
                <div className={cn(
                  "w-14 text-right text-xs tabular-nums",
                  delta == null ? "text-muted-foreground" : delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-emerald-500" : "text-destructive",
                )}>
                  {delta == null ? "—" : (delta > 0 ? "+" : "") + delta}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {diffs.length} item{diffs.length === 1 ? "" : "s"} will be adjusted under a single audit batch.
        </p>
      </div>
      <DialogFooter>
        <div className="flex-1" />
        <button onClick={onClose} className="px-3 py-2 text-xs">Cancel</button>
        <button onClick={() => save.mutate()} disabled={save.isPending || !diffs.length}
          className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-4 py-2 text-xs font-medium disabled:opacity-60">
          {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save Reconciliation
        </button>
      </DialogFooter>
    </DialogShell>
  );
}
