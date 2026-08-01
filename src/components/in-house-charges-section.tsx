import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Loader2, Receipt, DoorOpen } from "lucide-react";
import {
  listBookingCharges, createBookingCharge, updateBookingCharge,
  deleteBookingCharge, chargesTotal, type BookingChargeRow,
} from "@/lib/booking-charges-api";
import { listBookingItems } from "@/lib/booking-items-api";
import { listRooms } from "@/lib/rooms-api";
import { useChargeCategories } from "@/hooks/use-charge-categories";
import { useUserRole } from "@/hooks/use-role";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { NumField } from "@/components/num-field";
import { refreshAfterBookingMutation } from "@/lib/booking-pricing-sync";


const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
/**
 * UAT-032 — Every In-house Charge line displays date AND time using the
 * exact same formatter used by the Payments list (see bookings_.$id.tsx)
 * so the entire booking timeline is visually consistent.
 */
const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });

export function InHouseChargesSection({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const { isAdmin } = useUserRole();
  // Single source of truth: Charge Catalog (Operations → Charge Catalog).
  const { values: categories } = useChargeCategories();
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<BookingChargeRow | null>(null);
  const [defaultItemId, setDefaultItemId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["booking-charges", bookingId],
    queryFn: () => listBookingCharges(bookingId),
  });
  // Milestone 3 — load booking items + rooms so charges can be attributed to
  // a specific operational room. Attribution is stored on booking_charges.item_id
  // (nullable). Financial totals still aggregate at booking level.
  const itemsQ = useQuery({
    queryKey: ["booking-items", bookingId],
    queryFn: () => listBookingItems(bookingId),
    enabled: !!bookingId,
  });
  const roomsQ = useQuery({ queryKey: ["rooms"], queryFn: () => listRooms() });
  const items = itemsQ.data ?? [];
  const rooms = roomsQ.data ?? [];
  const itemLabel = (itemId: string | null): string => {
    if (!itemId) return "Booking-level";
    const it = items.find((i: any) => i.id === itemId);
    if (!it) return "Booking-level";
    const room = rooms.find((r: any) => r.id === (it as any).assigned_room_id);
    const idx = items.findIndex((i: any) => i.id === itemId) + 1;
    return room ? `Room ${room.room_number}` : `Room Item ${idx}`;
  };

  const delMut = useMutation({
    mutationFn: (id: string) => deleteBookingCharge(id),
    onSuccess: async () => {
      toast.success("Charge deleted");
      // UAT-034: every financial mutation flows through the shared booking
      // totals engine so Balance Due / Total Payable never drift.
      await refreshAfterBookingMutation(qc, bookingId);
      qc.invalidateQueries({ queryKey: ["all-charge-totals"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not delete"),
  });

  const rows = q.data ?? [];
  const total = chargesTotal(rows);

  // Milestone 3 — group displayed charges by attributed operational room, with
  // an "Unattributed / Booking-level" bucket at the top. Aggregation stays
  // booking-level (Balance Due, invoice, taxes) — this is a presentation-only
  // grouping to prepare for future per-room folios.
  const grouped = useMemo(() => {
    const groups = new Map<string, BookingChargeRow[]>();
    for (const r of rows) {
      const key = r.item_id ?? "__booking__";
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    const ordered: Array<{ key: string; label: string; rows: BookingChargeRow[] }> = [];
    if (groups.has("__booking__")) {
      ordered.push({ key: "__booking__", label: "Booking-level", rows: groups.get("__booking__")! });
    }
    for (const it of items as any[]) {
      if (groups.has(it.id)) {
        ordered.push({ key: it.id, label: itemLabel(it.id), rows: groups.get(it.id)! });
      }
    }
    // Any orphan item_ids (item deleted after charge posted) fall through last.
    for (const [k, v] of groups.entries()) {
      if (k === "__booking__") continue;
      if (!ordered.some((g) => g.key === k)) ordered.push({ key: k, label: "Unlinked room", rows: v });
    }
    return ordered;
  }, [rows, items, rooms]);

  return (
    <div className="luxe-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-gold" />
          <h3 className="font-display text-base">In-House Charges</h3>
        </div>
        <button
          onClick={() => { setEditing(null); setDefaultItemId(null); setOpenForm(true); }}
          className="inline-flex items-center gap-1.5 rounded-md gold-gradient px-3 py-1.5 text-xs font-medium text-charcoal"
        >
          <Plus className="h-3.5 w-3.5" /> Add Charge
        </button>
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-gold" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center text-xs text-muted-foreground py-3">No in-house charges yet.</div>
      ) : (
        <div className="space-y-3">
          {grouped.map((g) => (
            <div key={g.key} className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <DoorOpen className="h-3 w-3 text-gold" /> {g.label}
                </span>
                {items.length > 0 && g.key === "__booking__" && (
                  <button
                    onClick={() => { setEditing(null); setDefaultItemId(null); setOpenForm(true); }}
                    className="text-[10px] normal-case tracking-normal text-muted-foreground hover:text-gold"
                  >+ add</button>
                )}
                {items.length > 0 && g.key !== "__booking__" && (
                  <button
                    onClick={() => { setEditing(null); setDefaultItemId(g.key); setOpenForm(true); }}
                    className="text-[10px] normal-case tracking-normal text-muted-foreground hover:text-gold"
                  >+ add to this room</button>
                )}
              </div>
              {g.rows.map((r) => {
                // UAT-025: system-generated charges (Razorpay convenience fee auto-split)
                // must be visually distinct from staff-added charges.
                const isSystem = (r.added_by ?? "").toLowerCase() === "system"
                  || (r.added_by ?? "").toLowerCase().startsWith("system ")
                  || String(r.notes ?? "").toLowerCase().includes("[system-generated]");
                return (
                <div key={r.id} className={`flex items-center justify-between py-2 px-3 rounded-md text-sm ${isSystem ? "bg-gold-soft/30 border border-gold/30" : "bg-secondary/40"}`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate flex items-center gap-1.5">
                      {r.category}{r.category === "Other" && r.other_description ? ` · ${r.other_description}` : ""}
                      {isSystem && (
                        <span className="inline-flex items-center rounded-sm border border-gold/50 bg-gold-soft px-1.5 py-0 text-[9px] uppercase tracking-wider text-gold-dark">
                          Auto
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {Number(r.quantity)} × {inr(r.unit_price)} · {r.added_by ?? "—"} · {fmtDateTime(r.occurred_at)}
                      {r.notes ? ` · ${r.notes}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <span className="font-medium text-sm">{inr(r.amount)}</span>
                    <button
                      onClick={() => { setEditing(r); setDefaultItemId(r.item_id ?? null); setOpenForm(true); }}
                      className="p-1 rounded text-muted-foreground hover:text-gold" title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => { if (confirm("Delete this charge?")) delMut.mutate(r.id); }}
                        className="p-1 rounded text-muted-foreground hover:text-destructive" title="Delete (Admin)"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );})}
            </div>
          ))}
          <div className="flex justify-end pt-2 border-t border-border/40 text-sm font-medium">
            Total Charges: <span className="ml-2 text-gold">{inr(total)}</span>
          </div>
        </div>
      )}

      <ChargeFormDialog
        key={editing?.id ?? `new-${defaultItemId ?? "booking"}`}
        open={openForm}
        onOpenChange={(v) => { setOpenForm(v); if (!v) { setEditing(null); setDefaultItemId(null); } }}
        bookingId={bookingId}
        categories={categories}
        editing={editing}
        items={items as any[]}
        rooms={rooms as any[]}
        defaultItemId={defaultItemId}
      />
    </div>
  );
}


export function ChargeFormDialog({
  open, onOpenChange, bookingId, categories, editing,
  items = [], rooms = [], defaultItemId = null,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  bookingId: string; categories: string[]; editing: BookingChargeRow | null;
  items?: any[]; rooms?: any[]; defaultItemId?: string | null;
}) {
  const qc = useQueryClient();
  // Auto-attribution: the signed-in staff member is the source of truth for
  // "Added By". No manual picker — one staff cannot post charges under another.
  const currentStaff = useCurrentStaff();
  // Application-mode lookup drives per-room fan-out for the shared charge
  // workflow (Early Check-In × N rooms vs single Airport Transfer).
  const { modeFor } = useChargeCategories();
  const [category, setCategory] = useState(editing?.category ?? categories[0] ?? "Food Order");
  const [otherDesc, setOtherDesc] = useState(editing?.other_description ?? "");
  const [quantity, setQuantity] = useState<number>(editing?.quantity ?? 1);
  const [unitPrice, setUnitPrice] = useState<number>(editing?.unit_price ?? 0);

  // Multi-room aware "Charge To" behaviour.
  //   • Single-room booking → Charge-To is hidden and the sole item is
  //     auto-attributed.
  //   • Multi-room + per_booking category → hidden, stored booking-level.
  //   • Multi-room + per_room category → checkbox list (default all rooms
  //     selected). One charge line is created per selected room, attributed
  //     to the corresponding booking_item.
  const isSingleRoom = items.length === 1;
  const isMultiRoom = items.length > 1;
  const applicationMode = modeFor(category);
  const isPerRoom = applicationMode === "per_room";
  const isEditing = !!editing;

  // Single-room "Charge To" (kept for per_booking & Other in multi-room).
  const [itemId, setItemId] = useState<string | null>(
    editing?.item_id
      ?? defaultItemId
      ?? (isSingleRoom ? (items[0]?.id ?? null) : null),
  );

  // Per-room fan-out selection (multi-room + per_room, new charge only).
  // Default: every room selected. Editing an existing charge stays scoped
  // to the single line being edited.
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>(() => {
    if (isEditing) return editing?.item_id ? [editing.item_id] : [];
    if (defaultItemId) return [defaultItemId];
    return items.map((it: any) => it.id);
  });
  const toggleItem = (id: string) =>
    setSelectedItemIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const addedBy = editing?.added_by ?? currentStaff.name;
  const [occurredAt, setOccurredAt] = useState<string>(
    editing?.occurred_at ? new Date(editing.occurred_at).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");

  const lineAmount = Number((quantity * unitPrice).toFixed(2));
  // Multi-room per-room fan-out multiplies the line by number of selected rooms
  // in the preview total ONLY (each posted row still shows Qty × Unit).
  const fanOutRooms = !isEditing && isMultiRoom && isPerRoom ? selectedItemIds.length : 1;
  const previewTotal = Number((lineAmount * Math.max(fanOutRooms, 1)).toFixed(2));

  // Per-room categories require an explicit room. Per-booking categories are
  // allowed to be booking-level (item_id = null) but still honour an explicit
  // selection when the user makes one.
  const chargeToMissing = isMultiRoom && isPerRoom && isEditing && !itemId;
  const perRoomMissing =
    !isEditing && isMultiRoom && isPerRoom && selectedItemIds.length === 0;

  const mut = useMutation({
    mutationFn: async () => {
      const base = {
        booking_id: bookingId,
        category,
        other_description: category === "Other" ? otherDesc : null,
        quantity, unit_price: unitPrice,
        added_by: addedBy || null,
        occurred_at: new Date(occurredAt).toISOString(),
        notes: notes || null,
      };
      if (isEditing) {
        return updateBookingCharge(editing!.id, { ...base, item_id: itemId });
      }
      // Per-room fan-out: one row per selected operational room.
      if (isMultiRoom && isPerRoom) {
        if (selectedItemIds.length === 0)
          throw new Error("Select at least one room for this per-room charge.");
        const results = [];
        for (const iid of selectedItemIds) {
          results.push(await createBookingCharge({ ...base, item_id: iid }));
        }
        return results;
      }
      // Single-room → auto-attributed to the sole item.
      // Multi-room + per_booking → honour the "Charge To" selection when the
      // user picked a room; otherwise stay booking-level (item_id = null).
      const resolvedItemId = isSingleRoom
        ? (items[0]?.id ?? null)
        : (itemId ?? null);
      return createBookingCharge({ ...base, item_id: resolvedItemId });
    },


    onSuccess: async () => {
      const created = !isEditing && isMultiRoom && isPerRoom
        ? `${selectedItemIds.length} charges added`
        : (isEditing ? "Charge updated" : "Charge added");
      toast.success(created);
      // UAT-034: shared recalc engine keeps booking.amount / Balance Due /
      // House View pills in sync across every surface — no manual Save.
      await refreshAfterBookingMutation(qc, bookingId);
      qc.invalidateQueries({ queryKey: ["all-charge-totals"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const itemOptionLabel = (it: any, idx: number) => {
    const room = rooms.find((r: any) => r.id === it.assigned_room_id);
    const roomPart = room ? `Room ${room.room_number}` : "Unassigned";
    const occ = it.primary_occupant_name ? it.primary_occupant_name : `Guest ${idx + 1}`;
    return `${occ} · ${roomPart}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Charge" : "Add In-House Charge"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {/* Category is picked first so per-room fan-out UI knows which mode to render. */}
          <Field label="Category *">
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {isMultiRoom && !isEditing && (
              <span className="mt-1 block text-[10.5px] text-muted-foreground">
                {isPerRoom
                  ? "Per-room charge — one line will be posted for each selected room."
                  : "Per-booking charge — a single booking-level line will be posted."}
              </span>
            )}
          </Field>
          {category === "Other" && (
            <Field label="Description *">
              <input value={otherDesc} onChange={(e) => setOtherDesc(e.target.value)}
                placeholder="e.g. Spa booking"
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
            </Field>
          )}

          {/* Multi-room + per_room + new charge → checkbox fan-out. */}
          {isMultiRoom && isPerRoom && !isEditing && (
            <Field label="Apply To Rooms *">
              <div className={`rounded-md border ${perRoomMissing ? "border-destructive" : "border-border"} bg-input/40 divide-y divide-border/40`}>
                <div className="flex items-center justify-between px-3 py-1.5 text-[10.5px] text-muted-foreground">
                  <span>{selectedItemIds.length} of {items.length} rooms selected</span>
                  <button type="button" className="hover:text-gold"
                    onClick={() => setSelectedItemIds(
                      selectedItemIds.length === items.length ? [] : items.map((it: any) => it.id))}>
                    {selectedItemIds.length === items.length ? "Clear all" : "Select all"}
                  </button>
                </div>
                {items.map((it: any, idx: number) => {
                  const checked = selectedItemIds.includes(it.id);
                  return (
                    <label key={it.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-secondary/30">
                      <input type="checkbox" checked={checked} onChange={() => toggleItem(it.id)} />
                      <span className="flex-1 truncate">{itemOptionLabel(it, idx)}</span>
                    </label>
                  );
                })}
              </div>
              {perRoomMissing && (
                <span className="mt-1 block text-[10.5px] text-destructive">
                  Select at least one room.
                </span>
              )}
            </Field>
          )}

          {/* Multi-room + per_booking OR editing a multi-room line → single select. */}
          {isMultiRoom && (!isPerRoom || isEditing) && (
            <Field label={isPerRoom ? "Charge To" : "Charge To (booking-level allowed)"}>
              <select
                value={itemId ?? ""}
                onChange={(e) => setItemId(e.target.value || null)}
                className={`w-full bg-input/60 border rounded-md px-3 py-2 text-sm ${chargeToMissing ? "border-destructive" : "border-border"}`}
              >
                <option value="">{isPerRoom ? "Select room…" : "Booking-level (no specific room)"}</option>
                {items.map((it: any, idx: number) => (
                  <option key={it.id} value={it.id}>{itemOptionLabel(it, idx)}</option>
                ))}
              </select>
            </Field>
          )}
          {isSingleRoom && (
            <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
              Charging: <span className="text-foreground font-medium">{itemOptionLabel(items[0], 0)}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Quantity *" value={quantity} min={0} decimal onChange={setQuantity} />
            <NumField label="Unit Price * (tax incl.)" value={unitPrice} min={0} decimal onChange={setUnitPrice} prefix="₹" />
          </div>
          <div className="text-sm">
            {fanOutRooms > 1 ? (
              <>
                Line: <span className="font-medium">{inr(lineAmount)}</span>
                <span className="text-muted-foreground"> × {fanOutRooms} rooms</span>
                {" = "}
                <span className="font-medium text-gold">{inr(previewTotal)}</span>
              </>
            ) : (
              <>Amount: <span className="font-medium text-gold">{inr(lineAmount)}</span></>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Added By">
              <div className="w-full bg-input/40 border border-border rounded-md px-3 py-2 text-sm text-muted-foreground">
                {addedBy || <span className="italic">Signed-in user</span>}
              </div>
            </Field>
            <Field label="Date & Time">
              <input type="datetime-local" value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
            </Field>
          </div>
          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
          </Field>
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button
            disabled={
              mut.isPending
              || !category
              || !(quantity > 0)
              || (category === "Other" && !otherDesc.trim())
              || !addedBy.trim()
              || chargeToMissing
              || perRoomMissing
            }
            onClick={() => mut.mutate()}
            className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2 text-sm font-medium text-charcoal disabled:opacity-50"
          >
            {mut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editing
              ? "Update"
              : (fanOutRooms > 1 ? `Add ${fanOutRooms} Charges` : "Add")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}
