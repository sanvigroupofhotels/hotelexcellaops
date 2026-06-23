import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity-log";


export const PAYMENT_MODES = ["Cash", "UPI", "Bank Transfer", "Card", "Hotelzify", "OTA"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number] | string;

export interface BookingPaymentRow {
  id: string;
  user_id: string;
  booking_id: string;
  customer_id: string | null;
  amount: number;
  payment_mode: PaymentMode;
  collected_by: string;
  occurred_at: string;
  notes: string | null;
  utr: string | null;
  paid_to: string | null;
  is_refund?: boolean;
  refund_reason?: string | null;
  ocr_image_path?: string | null;
  ocr_extracted_text?: string | null;
  ocr_data?: any;
  ocr_corrections?: any;
  created_at: string;
  updated_at: string;
}

export interface BookingPaymentInput {
  booking_id: string;
  customer_id?: string | null;
  amount: number;
  payment_mode: PaymentMode;
  collected_by: string;
  occurred_at?: string;
  notes?: string | null;
  utr?: string | null;
  paid_to?: string | null;
  is_refund?: boolean;
  refund_reason?: string | null;
}

export async function listBookingPayments(booking_id: string) {
  const { data, error } = await supabase
    .from("booking_payments" as any)
    .select("*")
    .eq("booking_id", booking_id)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BookingPaymentRow[];
}

export async function createBookingPayment(input: BookingPaymentInput) {
  if (!(input.amount > 0)) throw new Error("Amount must be greater than zero");
  if (!input.payment_mode) throw new Error("Payment mode is required");
  if (!input.collected_by?.trim()) throw new Error("Collected by is required");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const row: any = {
    booking_id: input.booking_id,
    customer_id: input.customer_id ?? null,
    amount: input.amount,
    payment_mode: input.payment_mode,
    collected_by: input.collected_by.trim(),
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    notes: input.notes ?? null,
    utr: input.utr?.trim() || null,
    paid_to: input.paid_to?.trim() || null,
    is_refund: input.is_refund ?? false,
    refund_reason: input.refund_reason ?? null,
    user_id: user.id,
  };
  const { data, error } = await supabase.from("booking_payments" as any).insert(row).select().single();
  if (error) throw error;
  const created = data as unknown as BookingPaymentRow;
  void logActivity({
    page: "Payments",
    action: created.is_refund ? "payment_refunded" : "payment_recorded",
    entity_type: "booking_payment",
    entity_id: created.id,
    entity_reference: input.payment_mode,
    summary: `${created.is_refund ? "Refund" : "Payment"} · ₹${created.amount} · ${created.payment_mode} · by ${created.collected_by}`,
    after: {
      booking_id: created.booking_id,
      amount: created.amount,
      payment_mode: created.payment_mode,
      collected_by: created.collected_by,
      is_refund: !!created.is_refund,
      refund_reason: created.refund_reason ?? null,
    },
    metadata: { booking_id: created.booking_id },
    source: "manual",
  });
  return created;
}

export async function updateBookingPayment(id: string, patch: Partial<BookingPaymentInput>) {
  const row: any = { ...patch };
  if (patch.occurred_at) row.occurred_at = patch.occurred_at;
  if (patch.utr !== undefined) row.utr = patch.utr?.trim() || null;
  if (patch.paid_to !== undefined) row.paid_to = patch.paid_to?.trim() || null;
  const { data, error } = await supabase
    .from("booking_payments" as any).update(row).eq("id", id).select().single();
  if (error) throw error;
  return data as unknown as BookingPaymentRow;
}

export async function deleteBookingPayment(id: string) {
  const { error } = await supabase.from("booking_payments" as any).delete().eq("id", id);
  if (error) throw error;
}

// ============= Payment attachments (OCR screenshots) =============

export const PAYMENT_SCREENSHOTS_BUCKET = "payment-screenshots";

export async function signedAttachmentUrl(path: string | null | undefined, expiresInSeconds = 300): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(PAYMENT_SCREENSHOTS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Replace the attachment on an existing payment. Pass `null` file to clear. */
export async function replacePaymentAttachment(paymentId: string, bookingId: string, file: File | null): Promise<void> {
  // Fetch existing row to remove the old file (best effort).
  const { data: existing } = await supabase
    .from("booking_payments" as any)
    .select("ocr_image_path")
    .eq("id", paymentId)
    .maybeSingle();
  const oldPath = (existing as any)?.ocr_image_path as string | null | undefined;

  let newPath: string | null = null;
  if (file) {
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || "jpg").toLowerCase();
    newPath = `${bookingId || "_orphan"}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage
      .from(PAYMENT_SCREENSHOTS_BUCKET)
      .upload(newPath, file, { cacheControl: "3600", upsert: false, contentType: file.type || "image/jpeg" });
    if (up.error) throw up.error;
  }

  const { error } = await supabase
    .from("booking_payments" as any)
    .update({ ocr_image_path: newPath } as any)
    .eq("id", paymentId);
  if (error) throw error;

  if (oldPath) {
    // Fire and forget — storage cleanup
    void supabase.storage.from(PAYMENT_SCREENSHOTS_BUCKET).remove([oldPath]);
  }
}
