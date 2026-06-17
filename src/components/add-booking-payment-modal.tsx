import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { createBookingPayment, updateBookingPayment, PAYMENT_MODES, type BookingPaymentRow } from "@/lib/booking-payments-api";
import { listStaff } from "@/lib/cash-api";
import { useMasterData } from "@/hooks/use-master-data";
import { toast } from "sonner";
import { NumField } from "@/components/num-field";
import { PaymentOcrPicker, type ExtractedPayment } from "@/components/payment-ocr-picker";

/**
 * Shared "Add / Edit Payment" modal used by the booking detail page and the
 * House View popup. Pass `payment` to edit an existing row, omit to add a new one.
 *
 * Add mode supports three entry paths:
 *   - Manual (default)
 *   - Upload Screenshot → OCR → pre-fill (never auto-save)
 *   - Capture Photo     → OCR → pre-fill (never auto-save)
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
  const { data: staff = [] } = useQuery({ queryKey: ["staff", "active", "cashbook"], queryFn: () => listStaff(true, { availability: "cashbook" }) });
  const { values: paymentModes } = useMasterData("payment_method", [...PAYMENT_MODES]);

  const [amount, setAmount] = useState<number>(payment ? Number(payment.amount) : Math.max(0, maxAmount));
  const [mode, setMode] = useState<string>(payment?.payment_mode ?? paymentModes[0] ?? PAYMENT_MODES[0]);
  const [collectedBy, setCollectedBy] = useState<string>(payment?.collected_by ?? "");
  const [occurredAt, setOccurredAt] = useState<string>(() => {
    const d = payment ? new Date(payment.occurred_at) : new Date();
    const tz = d.getTimezoneOffset();
    return new Date(d.getTime() - tz * 60000).toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState(payment?.notes ?? "");

  // OCR audit fields (only set in Add mode when staff used Upload/Capture).
  const [ocrImagePath, setOcrImagePath] = useState<string | null>(null);
  const [ocrRawText, setOcrRawText] = useState<string | null>(null);
  const [ocrOriginal, setOcrOriginal] = useState<ExtractedPayment | null>(null);

  useEffect(() => { if (!collectedBy && staff[0]?.name) setCollectedBy(staff[0].name); }, [staff, collectedBy]);

  const handleExtracted = (r: { extracted: ExtractedPayment; raw_text: string; image_path: string }) => {
    setOcrImagePath(r.image_path);
    setOcrRawText(r.raw_text);
    setOcrOriginal(r.extracted);

    const x = r.extracted ?? {};
    if (typeof x.amount === "number" && x.amount > 0) setAmount(x.amount);
    if (x.app) {
      // Best-effort mapping of detected app → existing payment mode.
      const upiModes = paymentModes.filter((m) => /upi|phonepe|gpay|paytm|bharat/i.test(m));
      const match = paymentModes.find((m) => m.toLowerCase() === x.app!.toLowerCase())
        ?? upiModes[0]
        ?? paymentModes.find((m) => /upi/i.test(m))
        ?? mode;
      setMode(match);
    }
    if (x.date && x.time) {
      const iso = `${x.date}T${x.time.length === 5 ? x.time : x.time.slice(0,5)}`;
      // Keep local-time semantics for the datetime-local input.
      setOccurredAt(iso);
    }
    const noteBits: string[] = [];
    if (x.txn_id) noteBits.push(`UTR/Txn: ${x.txn_id}`);
    if (x.payer_name) noteBits.push(`Payer: ${x.payer_name}`);
    if (x.merchant_name) noteBits.push(`Merchant: ${x.merchant_name}`);
    if (noteBits.length) {
      setNotes((prev) => [prev, noteBits.join(" · ")].filter(Boolean).join("\n"));
    }
  };

  const buildPatchExtras = () => {
    if (!ocrImagePath) return {};
    // Diff edited values vs OCR original → corrections audit log.
    const corrections: Record<string, { ocr: any; saved: any }> = {};
    if (ocrOriginal) {
      const candidates: Array<[string, any, any]> = [
        ["amount", ocrOriginal.amount, amount],
        ["app", ocrOriginal.app, mode],
      ];
      for (const [k, a, b] of candidates) {
        if (a !== undefined && a !== null && String(a) !== String(b)) corrections[k] = { ocr: a, saved: b };
      }
    }
    return {
      ocr_image_path: ocrImagePath,
      ocr_extracted_text: ocrRawText,
      ocr_data: ocrOriginal as any,
      ocr_corrections: Object.keys(corrections).length ? corrections : null,
    };
  };

  const save = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        return updateBookingPayment(payment!.id, {
          amount, payment_mode: mode, collected_by: collectedBy,
          occurred_at: new Date(occurredAt).toISOString(), notes: notes || null,
        });
      }
      const row = await createBookingPayment({
        booking_id: bookingId, customer_id: customerId,
        amount, payment_mode: mode, collected_by: collectedBy,
        occurred_at: new Date(occurredAt).toISOString(),
        notes: notes || null,
      });
      const extras = buildPatchExtras();
      if (Object.keys(extras).length > 0) {
        await supabase.from("booking_payments" as any).update(extras as any).eq("id", row.id);
      }
      return row;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Payment updated" : "Payment added");
      qc.invalidateQueries({ queryKey: ["booking-payments", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking-payment-activities", bookingId] });
      qc.invalidateQueries({ queryKey: ["booking", bookingId] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["cash"] });
      qc.invalidateQueries({ queryKey: ["cash-tx-home"] });
      qc.invalidateQueries({ queryKey: ["all-booking-payments"] });
      onSaved?.(); onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="luxe-card rounded-xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-xl">{isEdit ? "Edit Payment" : "Add Payment"}</h3>

        {!isEdit && (
          <PaymentOcrPicker bookingId={bookingId} onExtracted={handleExtracted} />
        )}

        <div className="grid grid-cols-2 gap-3 text-sm">
          <NumField label="Amount *" value={amount} min={0} decimal onChange={setAmount} prefix="₹" />
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Mode *</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
              {paymentModes.map((m) => <option key={m}>{m}</option>)}
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
