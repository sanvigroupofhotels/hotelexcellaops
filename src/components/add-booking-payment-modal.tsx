import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createBookingPayment, updateBookingPayment, PAYMENT_MODES, type BookingPaymentRow } from "@/lib/booking-payments-api";
import { listStaff } from "@/lib/cash-api";
import { useMasterData } from "@/hooks/use-master-data";
import { toast } from "sonner";

/**
 * Shared "Add / Edit Payment" modal used by the booking detail page and the
 * House View popup. Pass `payment` to edit an existing row, omit to add a new one.
 */
export function AddBookingPaymentModal({
  bookingId, customerId, maxAmount, payment, onClose, onSaved,
}: {
  bookingId: string;
  customerId: string | null;
  maxAmount: number;
  payment?: BookingPaymentRow | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!payment;
  const { data: staff = [] } = useQuery({ queryKey: ["staff", "active"], queryFn: () => listStaff(true) });
  const [amount, setAmount] = useState<number>(payment ? Number(payment.amount) : Math.max(0, maxAmount));
  const [mode, setMode] = useState<string>(payment?.payment_mode ?? PAYMENT_MODES[0]);
  const [collectedBy, setCollectedBy] = useState<string>(payment?.collected_by ?? "");
  const [occurredAt, setOccurredAt] = useState<string>(() => {
    const d = payment ? new Date(payment.occurred_at) : new Date();
    const tz = d.getTimezoneOffset();
    return new Date(d.getTime() - tz * 60000).toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState(payment?.notes ?? "");

  useEffect(() => { if (!collectedBy && staff[0]?.name) setCollectedBy(staff[0].name); }, [staff, collectedBy]);

  const save = useMutation({
    mutationFn: () =>
      isEdit
        ? updateBookingPayment(payment!.id, {
            amount, payment_mode: mode, collected_by: collectedBy,
            occurred_at: new Date(occurredAt).toISOString(), notes: notes || null,
          })
        : createBookingPayment({
            booking_id: bookingId, customer_id: customerId,
            amount, payment_mode: mode, collected_by: collectedBy,
            occurred_at: new Date(occurredAt).toISOString(),
            notes: notes || null,
          }),
    onSuccess: () => {
      toast.success(isEdit ? "Payment updated" : "Payment added");
      qc.invalidateQueries({ queryKey: ["booking-payments", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking-payment-activities", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking", bookingId] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["cash"] });
      onSaved?.(); onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="luxe-card rounded-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-xl">{isEdit ? "Edit Payment" : "Add Payment"}</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount *</span>
            <input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Mode *</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
              {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label className="col-span-2 block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Collected By *</span>
            {staff.length > 0 ? (
              <select value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)}
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
                <option value="">Select…</option>
                {staff.map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            ) : (
              <input value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} placeholder="Staff name"
                className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
            )}
          </label>
          <label className="col-span-2 block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Date &amp; Time</span>
            <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
          </label>
          <label className="col-span-2 block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md border border-border bg-card px-3 py-2 text-xs">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || !collectedBy || !(amount > 0)}
            className="rounded-md gold-gradient px-4 py-2 text-xs font-medium text-charcoal disabled:opacity-50">
            {save.isPending ? "Saving…" : isEdit ? "Save Changes" : "Save Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
