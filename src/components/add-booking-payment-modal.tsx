import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  createBookingPayment, updateBookingPayment, replacePaymentAttachment,
  signedAttachmentUrl, PAYMENT_MODES, type BookingPaymentRow,
} from "@/lib/booking-payments-api";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import { useMasterData } from "@/hooks/use-master-data";
import { toast } from "sonner";
import { NumField } from "@/components/num-field";
import { PaymentOcrPicker, type ExtractedPayment } from "@/components/payment-ocr-picker";
import { Paperclip, Eye, Upload, Trash2, Loader2 } from "lucide-react";

/**
 * Shared "Add / Edit Payment" modal used by the booking detail page and the
 * House View popup. Pass `payment` to edit an existing row, omit to add a new one.
 *
 * Add mode supports three entry paths:
 *   - Manual (default)
 *   - Upload Screenshot → OCR → pre-fill (never auto-save)
 *   - Capture Photo     → OCR → pre-fill (never auto-save)
 *
 * UTR and Paid To are exposed as editable fields; OCR pre-fills them from
 * the detected transaction reference and merchant name.
 *
 * Edit mode also exposes the existing OCR attachment with View / Replace /
 * Delete affordances.
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
  // Auto-attribution: the signed-in staff member is the source of truth for
  // "Collected By". No manual picker.
  const currentStaff = useCurrentStaff();
  const { values: paymentModes } = useMasterData("payment_method", [...PAYMENT_MODES]);

  const [amount, setAmount] = useState<number>(payment ? Number(payment.amount) : Math.max(0, maxAmount));
  const [mode, setMode] = useState<string>(payment?.payment_mode ?? paymentModes[0] ?? PAYMENT_MODES[0]);
  // Preserve historical attribution on edit; otherwise use the signed-in user.
  const collectedBy = payment?.collected_by ?? currentStaff.name;
  const [occurredAt, setOccurredAt] = useState<string>(() => {
    const d = payment ? new Date(payment.occurred_at) : new Date();
    const tz = d.getTimezoneOffset();
    return new Date(d.getTime() - tz * 60000).toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState(payment?.notes ?? "");
  const [utr, setUtr] = useState<string>(payment?.utr ?? "");
  const [paidTo, setPaidTo] = useState<string>(payment?.paid_to ?? "");

  // OCR audit fields (only set in Add mode when staff used Upload/Capture).
  const [ocrImagePath, setOcrImagePath] = useState<string | null>(null);
  const [ocrRawText, setOcrRawText] = useState<string | null>(null);
  const [ocrOriginal, setOcrOriginal] = useState<ExtractedPayment | null>(null);

  // Edit mode: show existing attachment + replace/delete
  const [attachmentPath, setAttachmentPath] = useState<string | null>(payment?.ocr_image_path ?? null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);

  const handleExtracted = (r: { extracted: ExtractedPayment; raw_text: string; image_path: string }) => {
    setOcrImagePath(r.image_path);
    setOcrRawText(r.raw_text);
    setOcrOriginal(r.extracted);

    const x = r.extracted ?? {};
    if (typeof x.amount === "number" && x.amount > 0) setAmount(x.amount);
    if (x.app) {
      const upiModes = paymentModes.filter((m) => /upi|phonepe|gpay|paytm|bharat/i.test(m));
      const match = paymentModes.find((m) => m.toLowerCase() === x.app!.toLowerCase())
        ?? upiModes[0]
        ?? paymentModes.find((m) => /upi/i.test(m))
        ?? mode;
      setMode(match);
    }
    if (x.date && x.time) {
      const iso = `${x.date}T${x.time.length === 5 ? x.time : x.time.slice(0,5)}`;
      setOccurredAt(iso);
    }
    if (x.txn_id) setUtr(x.txn_id);
    if (x.merchant_name) setPaidTo(x.merchant_name);

    const noteBits: string[] = [];
    if (x.payer_name) noteBits.push(`Payer: ${x.payer_name}`);
    if (noteBits.length) {
      setNotes((prev) => [prev, noteBits.join(" · ")].filter(Boolean).join("\n"));
    }
  };

  const buildPatchExtras = () => {
    if (!ocrImagePath) return {};
    const corrections: Record<string, { ocr: any; saved: any }> = {};
    if (ocrOriginal) {
      const candidates: Array<[string, any, any]> = [
        ["amount", ocrOriginal.amount, amount],
        ["app", ocrOriginal.app, mode],
        ["txn_id", ocrOriginal.txn_id, utr],
        ["merchant_name", ocrOriginal.merchant_name, paidTo],
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
          occurred_at: new Date(occurredAt).toISOString(),
          notes: notes || null, utr: utr || null, paid_to: paidTo || null,
        });
      }
      const row = await createBookingPayment({
        booking_id: bookingId, customer_id: customerId,
        amount, payment_mode: mode, collected_by: collectedBy,
        occurred_at: new Date(occurredAt).toISOString(),
        notes: notes || null, utr: utr || null, paid_to: paidTo || null,
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

  const onAttachmentFile = async (file: File | null) => {
    if (!isEdit || !payment) return;
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image"); return; }
    setAttachmentBusy(true);
    try {
      await replacePaymentAttachment(payment.id, bookingId, file);
      // Fetch new path
      const { data } = await supabase.from("booking_payments" as any).select("ocr_image_path").eq("id", payment.id).maybeSingle();
      setAttachmentPath((data as any)?.ocr_image_path ?? null);
      qc.invalidateQueries({ queryKey: ["booking-payments", bookingId] });
      qc.invalidateQueries({ queryKey: ["all-booking-payments"] });
      toast.success("Attachment updated");
    } catch (e: any) { toast.error(e?.message ?? "Could not replace attachment"); }
    finally { setAttachmentBusy(false); }
  };

  const onAttachmentDelete = async () => {
    if (!isEdit || !payment) return;
    if (!confirm("Remove this attachment?")) return;
    setAttachmentBusy(true);
    try {
      await replacePaymentAttachment(payment.id, bookingId, null);
      setAttachmentPath(null);
      qc.invalidateQueries({ queryKey: ["booking-payments", bookingId] });
      qc.invalidateQueries({ queryKey: ["all-booking-payments"] });
      toast.success("Attachment removed");
    } catch (e: any) { toast.error(e?.message ?? "Could not remove attachment"); }
    finally { setAttachmentBusy(false); }
  };

  const onAttachmentView = async () => {
    if (!attachmentPath) return;
    const url = await signedAttachmentUrl(attachmentPath, 300);
    if (url) window.open(url, "_blank");
    else toast.error("Could not open attachment");
  };

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
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">UTR / Txn Ref</span>
            <input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. 5123…"
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm font-mono" />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Paid To</span>
            <input value={paidTo} onChange={(e) => setPaidTo(e.target.value)} placeholder="Merchant / payee"
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
          </label>
          <label className="col-span-2 block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Collected By</span>
            <div className="w-full bg-input/40 border border-border rounded-md px-3 py-2 text-sm text-muted-foreground">
              {collectedBy || <span className="italic">Signed-in user</span>}
            </div>
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

        {isEdit && (
          <div className="rounded-md border border-border bg-card/40 p-3 space-y-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Paperclip className="h-3.5 w-3.5 text-gold" /> Payment Attachment
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {attachmentPath ? (
                <button onClick={onAttachmentView} type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40">
                  <Eye className="h-3.5 w-3.5" /> View
                </button>
              ) : (
                <span className="text-[11px] text-muted-foreground italic">No attachment on this payment.</span>
              )}
              <label className={`inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40 ${attachmentBusy ? "opacity-50 pointer-events-none" : ""}`}>
                <Upload className="h-3.5 w-3.5" /> {attachmentPath ? "Replace" : "Attach"}
                <input type="file" accept="image/*" className="hidden"
                  onChange={(e) => onAttachmentFile(e.target.files?.[0] ?? null)} />
              </label>
              {attachmentPath && (
                <button onClick={onAttachmentDelete} type="button" disabled={attachmentBusy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive hover:bg-destructive/20">
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              )}
              {attachmentBusy && <Loader2 className="h-4 w-4 animate-spin text-gold" />}
            </div>
          </div>
        )}

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
