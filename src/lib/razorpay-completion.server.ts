/**
 * Shared Razorpay payment-completion workflow (single implementation).
 *
 * Both entry points — the guest-portal client confirmation
 * (`confirmRazorpayPayment` in `portal.functions.ts`) and the dashboard
 * webhook (`/api/public/razorpay-webhook`) — call `completeRazorpayCapture`
 * so behaviour is identical for FULL and PARTIAL payments.
 *
 * Workflow (UAT — Financial Consistency):
 *   1. Record the guest payment (the amount they intended to pay).
 *   2. If Razorpay captured MORE than the requested order amount, the excess
 *      is the convenience / gateway fee → post it as a "Razorpay Charges"
 *      in-house charge and auto-settle it with a second payment row.
 *   3. Booking total / amount paid / balance due are recomputed by the
 *      existing DB triggers on booking_payments + booking_charges.
 *   4. Log a `razorpay_fee_adjustment` booking activity for the ledger.
 *
 * Fee detection is based on `razorpay_orders.amount_paise` (what the guest was
 * asked to pay) rather than the booking's outstanding balance. That is what
 * makes partial payments behave exactly like full payments: a ₹3,000 partial
 * with a ₹90 fee captures ₹3,090 against a ₹3,000 order → ₹3,000 payment +
 * ₹90 Razorpay charge, even though the folio still has a balance.
 *
 * Fallback: when the order row is missing (legacy / manually created orders),
 * we fall back to the outstanding-balance comparison so no fee is lost.
 */
import { buildBookingChargeRow } from "@/lib/booking-charge-row";

const DUST = 0.005; // half a paisa tolerance

export interface RazorpayCaptureInput {
  supabaseAdmin: any;
  bookingId: string;
  amountInr: number;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature?: string | null;
  method?: string | null;
  /** Free-form suffix appended to the primary payment note (e.g. token hint). */
  noteSuffix?: string;
  /** Collection channel recorded on the payment rows. */
  collectedBy?: string;
}

export interface RazorpayCaptureResult {
  ok: boolean;
  alreadyRecorded: boolean;
  primaryAmount: number;
  feeAmount: number;
}

/** Rounds to 2 decimals in a money-safe way. */
const money = (n: number) => Math.round(n * 100) / 100;

/**
 * Splits a captured amount into (guest payment, gateway fee).
 * Exported for regression tests — pure, no I/O.
 */
export function splitRazorpayCapture(opts: {
  amountInr: number;
  orderAmountInr: number | null;
  outstandingInr: number;
}): { primaryAmount: number; feeAmount: number } {
  const { amountInr, orderAmountInr, outstandingInr } = opts;
  // Preferred: compare against what the guest was asked to pay (works for
  // partial AND full payments).
  if (orderAmountInr != null && orderAmountInr > 0) {
    if (amountInr > orderAmountInr + DUST) {
      return {
        primaryAmount: money(orderAmountInr),
        feeAmount: money(amountInr - orderAmountInr),
      };
    }
    return { primaryAmount: money(amountInr), feeAmount: 0 };
  }
  // Fallback: outstanding-balance comparison (legacy behaviour).
  if (outstandingInr > 0 && amountInr > outstandingInr + DUST) {
    return {
      primaryAmount: money(outstandingInr),
      feeAmount: money(amountInr - outstandingInr),
    };
  }
  return { primaryAmount: money(amountInr), feeAmount: 0 };
}

export async function completeRazorpayCapture(
  input: RazorpayCaptureInput,
): Promise<RazorpayCaptureResult> {
  const {
    supabaseAdmin, bookingId, amountInr, razorpayOrderId, razorpayPaymentId,
    razorpaySignature = null, method = null, noteSuffix = "",
    collectedBy = "Guest Portal",
  } = input;

  const { data: booking } = await supabaseAdmin
    .from("bookings")
    .select("id, user_id, customer_id, amount, advance_paid")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) throw new Error("Booking not found");

  // Intended (requested) amount for this order.
  const { data: orderRow } = await supabaseAdmin
    .from("razorpay_orders")
    .select("amount_paise")
    .eq("order_id", razorpayOrderId)
    .maybeSingle();
  const orderAmountInr = orderRow?.amount_paise != null
    ? Number(orderRow.amount_paise) / 100
    : null;

  // Outstanding (fallback path only).
  const { data: chargeRows } = await supabaseAdmin
    .from("booking_charges")
    .select("amount")
    .eq("booking_id", bookingId);
  const chargesTotal = ((chargeRows ?? []) as any[]).reduce(
    (s, r) => s + Number(r.amount || 0), 0,
  );
  const bookingTotal = Number((booking as any).amount ?? 0) + chargesTotal;
  const alreadyPaid = Number((booking as any).advance_paid ?? 0);
  const outstanding = Math.max(0, bookingTotal - alreadyPaid);

  const { primaryAmount, feeAmount } = splitRazorpayCapture({
    amountInr, orderAmountInr, outstandingInr: outstanding,
  });

  const markOrderPaid = () =>
    supabaseAdmin
      .from("razorpay_orders")
      .update({ status: "paid", captured_at: new Date().toISOString() } as any)
      .eq("order_id", razorpayOrderId);

  const { error: insErr } = await supabaseAdmin.from("booking_payments").insert({
    booking_id: bookingId,
    customer_id: (booking as any).customer_id,
    amount: primaryAmount,
    payment_mode: "Razorpay",
    collected_by: collectedBy,
    occurred_at: new Date().toISOString(),
    notes: `Razorpay ${razorpayPaymentId}${noteSuffix}${feeAmount > 0 ? ` · fee split ₹${feeAmount.toFixed(2)}` : ""}`,
    user_id: (booking as any).user_id,
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    razorpay_signature: razorpaySignature,
    razorpay_method: method,
  } as any);

  if (insErr) {
    const dup = (insErr as any).code === "23505"
      || String((insErr as any).message || "").toLowerCase().includes("duplicate");
    if (dup) {
      // The other entry point already ran this exact workflow. Never re-post
      // the fee — that would double-charge the guest.
      await markOrderPaid();
      return { ok: true, alreadyRecorded: true, primaryAmount, feeAmount: 0 };
    }
    console.error("completeRazorpayCapture: payment insert failed", insErr);
    throw new Error("Could not record payment");
  }

  if (feeAmount > 0) {
    // Non-blocking — the guest credit already landed.
    try {
      // Shared charge creation path: the row is shaped and validated by the
      // canonical builder, so gateway fees are identical to staff-entered
      // charges (amount arithmetic, defaults, `occurred_at`).
      const feeRow = buildBookingChargeRow(
        {
          booking_id: bookingId,
          category: "Razorpay Charges",
          quantity: 1,
          unit_price: feeAmount,
          // `[system-generated]` drives the "Auto" badge in the charges list.
          notes: `[system-generated] Payment gateway fee · Razorpay ${razorpayPaymentId}`,
          added_by: "System (Razorpay)",
          // Gateway fees are always booking-level (never room-attributed).
          item_id: null,
        },
        (booking as any).user_id,
      );
      const { error: chErr } = await supabaseAdmin
        .from("booking_charges")
        .insert(feeRow as any);
      if (chErr) throw chErr;

      await supabaseAdmin.from("booking_payments").insert({
        booking_id: bookingId,
        customer_id: (booking as any).customer_id,
        amount: feeAmount,
        payment_mode: "Razorpay",
        collected_by: collectedBy,
        occurred_at: new Date().toISOString(),
        notes: `Razorpay convenience fee · settles gateway charge for ${razorpayPaymentId}`,
        utr: razorpayPaymentId,
        user_id: (booking as any).user_id,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: null,
        razorpay_method: method,
      } as any);

      await supabaseAdmin.from("booking_activities").insert({
        booking_id: bookingId,
        action: "razorpay_fee_adjustment" as any,
        from_status: null,
        to_status: null,
        actor_id: null,
        actor_name: "System",
        actor_role: "system",
        notes: `Razorpay convenience fee ₹${feeAmount.toFixed(2)} recorded as In-house Charge (Razorpay Charges) · auto-generated for ${razorpayPaymentId}`,
        metadata: {
          razorpay_payment_id: razorpayPaymentId,
          razorpay_order_id: razorpayOrderId,
          fee_amount: feeAmount,
          order_amount: orderAmountInr,
          booking_due_at_capture: outstanding,
          amount_captured: amountInr,
          system_generated: true,
        },
      } as any);
    } catch (feeErr) {
      console.error("Razorpay fee split failed (non-blocking):", feeErr);
    }
  }

  await markOrderPaid();
  return { ok: true, alreadyRecorded: false, primaryAmount, feeAmount };
}
