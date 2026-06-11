import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Loader2, Receipt } from "lucide-react";
import {
  listBookingCharges, createBookingCharge, updateBookingCharge,
  deleteBookingCharge, chargesTotal, type BookingChargeRow,
} from "@/lib/booking-charges-api";
import { useMasterData } from "@/hooks/use-master-data";
import { useUserRole } from "@/hooks/use-role";
import { listStaff } from "@/lib/cash-api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { NumField } from "@/components/num-field";

const DEFAULT_CATEGORIES = [
  "Food Order", "Water Bottles", "Laundry", "Dental Kit", "Shaving Kit",
  "Coffee", "Tea", "Late Check-out", "Early Check-in", "Extra Pet",
  "Extra Adult", "Transportation", "Other",
];

const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

export function InHouseChargesSection({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const { isAdmin } = useUserRole();
  const { values: categories } = useMasterData("in_house_charge", DEFAULT_CATEGORIES);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<BookingChargeRow | null>(null);

  const q = useQuery({
    queryKey: ["booking-charges", bookingId],
    queryFn: () => listBookingCharges(bookingId),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteBookingCharge(id),
    onSuccess: () => {
      toast.success("Charge deleted");
      qc.invalidateQueries({ queryKey: ["booking-charges", bookingId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not delete"),
  });

  const rows = q.data ?? [];
  const total = chargesTotal(rows);

  return (
    <div className="luxe-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-gold" />
          <h3 className="font-display text-base">In-House Charges</h3>
          {total > 0 && (
            <span className="text-xs text-muted-foreground">· {rows.length} item{rows.length === 1 ? "" : "s"} · {inr(total)}</span>
          )}
        </div>
        <button
          onClick={() => { setEditing(null); setOpenForm(true); }}
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
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between py-2 px-3 rounded-md bg-secondary/40 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">
                  {r.category}{r.category === "Other" && r.other_description ? ` · ${r.other_description}` : ""}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {Number(r.quantity)} × {inr(r.unit_price)} · {r.added_by ?? "—"} · {new Date(r.occurred_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  {r.notes ? ` · ${r.notes}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-3">
                <span className="font-medium text-sm">{inr(r.amount)}</span>
                <button
                  onClick={() => { setEditing(r); setOpenForm(true); }}
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
          ))}
          <div className="flex justify-end pt-2 border-t border-border/40 text-sm font-medium">
            Total Charges: <span className="ml-2 text-gold">{inr(total)}</span>
          </div>
        </div>
      )}

      <ChargeFormDialog
        key={editing?.id ?? "new"}
        open={openForm}
        onOpenChange={(v) => { setOpenForm(v); if (!v) setEditing(null); }}
        bookingId={bookingId}
        categories={categories}
        editing={editing}
      />
    </div>
  );
}

function ChargeFormDialog({
  open, onOpenChange, bookingId, categories, editing,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  bookingId: string; categories: string[]; editing: BookingChargeRow | null;
}) {
  const qc = useQueryClient();
  const { data: staff = [] } = useQuery({ queryKey: ["staff", "active"], queryFn: () => listStaff(true) });
  const [category, setCategory] = useState(editing?.category ?? categories[0] ?? "Food Order");
  const [otherDesc, setOtherDesc] = useState(editing?.other_description ?? "");
  const [quantity, setQuantity] = useState<number>(editing?.quantity ?? 1);
  const [unitPrice, setUnitPrice] = useState<number>(editing?.unit_price ?? 0);
  const [addedBy, setAddedBy] = useState(editing?.added_by ?? "");
  const [occurredAt, setOccurredAt] = useState<string>(
    editing?.occurred_at ? new Date(editing.occurred_at).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");

  const amount = Number((quantity * unitPrice).toFixed(2));

  const mut = useMutation({
    mutationFn: async () => {
      const payload = {
        booking_id: bookingId,
        category,
        other_description: category === "Other" ? otherDesc : null,
        quantity, unit_price: unitPrice,
        added_by: addedBy || null,
        occurred_at: new Date(occurredAt).toISOString(),
        notes: notes || null,
      };
      if (editing) return updateBookingCharge(editing.id, payload);
      return createBookingCharge(payload);
    },
    onSuccess: () => {
      toast.success(editing ? "Charge updated" : "Charge added");
      qc.invalidateQueries({ queryKey: ["booking-charges", bookingId] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Charge" : "Add In-House Charge"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Field label="Category *">
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          {category === "Other" && (
            <Field label="Description *">
              <input value={otherDesc} onChange={(e) => setOtherDesc(e.target.value)}
                placeholder="e.g. Spa booking"
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Quantity *">
              <input type="number" min="0" step="any" value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value) || 0)}
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
            </Field>
            <Field label="Unit Price * (tax incl.)">
              <input type="number" min="0" step="any" value={unitPrice}
                onChange={(e) => setUnitPrice(Number(e.target.value) || 0)}
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
            </Field>
          </div>
          <div className="text-sm">Amount: <span className="font-medium text-gold">{inr(amount)}</span></div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Added By *">
              {staff.length > 0 ? (
                <select value={addedBy} onChange={(e) => setAddedBy(e.target.value)}
                  className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
                  <option value="">Select…</option>
                  {/* Preserve historical staff name even if deactivated */}
                  {addedBy && !staff.some((s: any) => s.name === addedBy) && (
                    <option value={addedBy}>{addedBy} (inactive)</option>
                  )}
                  {staff.map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              ) : (
                <input value={addedBy} onChange={(e) => setAddedBy(e.target.value)}
                  placeholder="Staff name"
                  className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
              )}
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
            disabled={mut.isPending || !category || !(quantity > 0) || (category === "Other" && !otherDesc.trim()) || !addedBy.trim()}
            onClick={() => mut.mutate()}
            className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2 text-sm font-medium text-charcoal disabled:opacity-50"
          >
            {mut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editing ? "Update" : "Add"}
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
