/**
 * Razorpay webhook — receives payment events and credits booking_payments.
 *
 * URL: /api/public/razorpay-webhook  (configure in Razorpay dashboard)
 *
 * Security & correctness:
 *   1. Verify `x-razorpay-signature` (HMAC-SHA256 of raw body) with timing-safe
 *      compare. Reject 401 on mismatch, no side effects.
 *   2. Idempotency: the raw event is inserted into `razorpay_webhook_events`
 *      with a UNIQUE(event_id). Razorpay retries (or duplicate deliveries) hit
 *      the unique constraint and short-circuit with 200 OK.
 *   3. Duplicate-payment protection: `booking_payments` has a UNIQUE partial
 *      index on `razorpay_payment_id`, so even a race between webhook + client
 *      confirm cannot double-credit.
 *   4. Booking confirmation is derived by existing DB triggers on
 *      booking_payments (advance_paid recompute, status derivation, cashbook
 *      sync). Client-side checkout success is NEVER treated as final — the
 *      webhook is the source of truth.
 *
 * v1.1 UAT-025 — Convenience-fee reconciliation:
 *   Razorpay may capture MORE than the booking's due amount when the guest
 *   pays the platform convenience fee on top of the invoice. Left untouched,
 *   the folio ends up over-paid and the fee is invisible in reporting. When
 *   the captured amount exceeds the current outstanding balance, we split
 *   the credit:
 *     • booking_payment #1 = outstanding balance (paid_to = the booking)
 *     • booking_charge     = "Razorpay Charges" for the excess
 *     • booking_payment #2 = excess (marked paid, same Razorpay txn id in
 *                             notes for future reconciliation)
 *   Both payments carry `razorpay_order_id` / `razorpay_payment_id` in
 *   notes so audit trail is preserved. The unique constraint on
 *   `razorpay_payment_id` is intentionally applied to only the first
 *   payment row — the second uses NULL there and stores the ref in `utr`.
 *
 * Handled events:
 *   - payment.captured  → credit booking_payments (with fee split)
 *   - payment.authorized → credit booking_payments (auto-capture flow)
 *   - payment.failed    → mark razorpay_orders as failed (no payment row)
 *   - order.paid        → mark razorpay_orders as paid (safety net)
 *
 * Other events are acknowledged with 200 so Razorpay stops retrying.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-razorpay-signature, x-razorpay-event-id",
} as const;

function ok(msg = "ok") {
  return new Response(msg, { status: 200, headers: CORS_HEADERS });
}
function err(status: number, msg: string) {
  return new Response(msg, { status, headers: CORS_HEADERS });
}

export const Route = createFileRoute("/api/public/razorpay-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) {
          console.error("RAZORPAY_WEBHOOK_SECRET not configured");
          return err(500, "Server misconfigured");
        }

        const signature = request.headers.get("x-razorpay-signature");
        const body = await request.text();
        if (!signature) return err(401, "Missing signature");

        // 1) Verify signature (timing-safe)
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        try {
          const sig = Buffer.from(signature);
          const exp = Buffer.from(expected);
          if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
            return err(401, "Invalid signature");
          }
        } catch {
          return err(401, "Invalid signature");
        }

        let payload: any;
        try {
          payload = JSON.parse(body);
        } catch {
          return err(400, "Invalid JSON");
        }

        const event = payload?.event as string | undefined;
        const paymentEntity = payload?.payload?.payment?.entity;
        const orderEntity = payload?.payload?.order?.entity;
        const razorpay_payment_id = paymentEntity?.id as string | undefined;
        const razorpay_order_id =
          (paymentEntity?.order_id as string | undefined) ?? (orderEntity?.id as string | undefined);
        const headerEventId = request.headers.get("x-razorpay-event-id") ?? null;
        const event_id =
          headerEventId ||
          `${event}:${razorpay_payment_id ?? razorpay_order_id ?? payload?.created_at ?? ""}`;

        if (!event) return err(400, "Missing event");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 2) Idempotently record the event. Unique(event_id) blocks retries.
        const { error: recErr } = await supabaseAdmin
          .from("razorpay_webhook_events")
          .insert({
            event_id,
            event_type: event,
            razorpay_order_id: razorpay_order_id ?? null,
            razorpay_payment_id: razorpay_payment_id ?? null,
            payload,
          } as any);
        if (recErr) {
          const msg = String((recErr as any).message || "").toLowerCase();
          if ((recErr as any).code === "23505" || msg.includes("duplicate")) {
            return ok();
          }
          console.error("razorpay_webhook_events insert failed:", recErr);
        }

        try {
          if (event === "payment.captured" || event === "payment.authorized") {
            if (!paymentEntity || !razorpay_payment_id || !razorpay_order_id) {
              return err(400, "Missing payment fields");
            }
            const amountPaise = Number(paymentEntity.amount) || 0;
            const amountInr = amountPaise / 100;
            const method = paymentEntity.method as string | undefined;
            const notes = paymentEntity.notes || {};
            const booking_id = notes.booking_id as string | undefined;
            const token = notes.token as string | undefined;

            if (!booking_id || amountInr <= 0) {
              console.error("Webhook missing booking_id or amount", { booking_id, amountInr });
              return err(400, "Missing booking_id");
            }

            const { data: booking } = await supabaseAdmin
              .from("bookings")
              .select("user_id, customer_id, status, amount, advance_paid, booking_reference")
              .eq("id", booking_id)
              .maybeSingle();
            if (!booking) return err(404, "Booking not found");

            // Compute outstanding balance including in-house charges — needed
            // for the convenience-fee split. Any charges already on the folio
            // (Past Due, laundry, F&B) count towards the "real" due.
            const { data: chargeRows } = await supabaseAdmin
              .from("booking_charges")
              .select("amount")
              .eq("booking_id", booking_id);
            const chargesTotal = ((chargeRows ?? []) as any[]).reduce(
              (s, r) => s + Number(r.amount || 0), 0,
            );
            const bookingTotal = Number((booking as any).amount ?? 0) + chargesTotal;
            const alreadyPaid = Number((booking as any).advance_paid ?? 0);
            const outstanding = Math.max(0, bookingTotal - alreadyPaid);

            // Dust tolerance — anything more than half a paisa above the
            // outstanding balance is treated as a convenience/gateway fee.
            // A ₹1 threshold silently absorbed typical Razorpay fees
            // (e.g. ₹0.02 on ₹1.00) into the booking payment.
            const EXCESS_THRESHOLD = 0.005;
            const primaryAmount =
              amountInr > outstanding + EXCESS_THRESHOLD && outstanding > 0
                ? outstanding
                : amountInr;
            const excessAmount = Math.max(0, amountInr - primaryAmount);

            // Primary payment — always inserted (may be full amount when no
            // outstanding tracked — treats as advance).
            const { error: insErr } = await supabaseAdmin.from("booking_payments").insert({
              booking_id,
              customer_id: (booking as any).customer_id,
              amount: primaryAmount,
              payment_mode: "Razorpay",
              collected_by: "Guest Portal",
              occurred_at: new Date().toISOString(),
              notes: `Razorpay ${razorpay_payment_id}${token ? ` · token ${String(token).slice(0, 8)}…` : ""}${excessAmount > 0 ? ` · fee split ₹${excessAmount.toFixed(2)}` : ""}`,
              user_id: (booking as any).user_id,
              razorpay_order_id,
              razorpay_payment_id,
              razorpay_method: method ?? null,
            } as any);

            if (insErr) {
              const dup =
                (insErr as any).code === "23505" ||
                String(insErr.message || "").toLowerCase().includes("duplicate");
              if (!dup) {
                console.error("Failed to insert booking_payment from webhook:", insErr);
                await supabaseAdmin
                  .from("razorpay_webhook_events")
                  .update({ processing_error: String((insErr as any).message || insErr) } as any)
                  .eq("event_id", event_id);
                return err(500, "DB error");
              }
              // Duplicate — client confirm already recorded it. Skip the split
              // to avoid double-charging the fee.
            } else if (excessAmount > 0) {
              // Convenience-fee split: create the charge + auto-pay it.
              // Non-blocking on failure — the primary credit already landed.
              try {
                const { error: chErr } = await supabaseAdmin.from("booking_charges").insert({
                  booking_id,
                  user_id: (booking as any).user_id,
                  category: "Razorpay Charges",
                  quantity: 1,
                  unit_price: Math.round(excessAmount * 100) / 100,
                  amount: Math.round(excessAmount * 100) / 100,
                  // UAT-025: `[system-generated]` marker is what `in-house-charges-section.tsx`
                  // keys off to render the "Auto" badge + highlighted background.
                  notes: `[system-generated] Payment gateway fee · Razorpay ${razorpay_payment_id}`,
                  added_by: "System (Razorpay)",
                  occurred_at: new Date().toISOString(),
                } as any);
                if (chErr) throw chErr;

                // Second payment offsets the charge. Razorpay ref in `utr` so
                // the primary payment can keep the unique `razorpay_payment_id`.
                await supabaseAdmin.from("booking_payments").insert({
                  booking_id,
                  customer_id: (booking as any).customer_id,
                  amount: Math.round(excessAmount * 100) / 100,
                  payment_mode: "Razorpay",
                  collected_by: "Guest Portal",
                  occurred_at: new Date().toISOString(),
                  notes: `Razorpay convenience fee · settles gateway charge for ${razorpay_payment_id}`,
                  utr: razorpay_payment_id,
                  user_id: (booking as any).user_id,
                  razorpay_order_id,
                  razorpay_payment_id: null,
                  razorpay_method: method ?? null,
                } as any);

                // v1.1 UAT-025 — explicit activity trail so the auto-adjustment
                // is discoverable from the booking's Activity History, not just
                // implicit in the charges list.
                await supabaseAdmin.from("booking_activities").insert({
                  booking_id,
                  action: "razorpay_fee_adjustment" as any,
                  from_status: null,
                  to_status: null,
                  actor_id: null,
                  actor_name: "System",
                  actor_role: "system",
                  notes: `Razorpay convenience fee ₹${excessAmount.toFixed(2)} recorded as In-house Charge (Razorpay Charges) · auto-generated for ${razorpay_payment_id}`,
                  metadata: {
                    razorpay_payment_id,
                    razorpay_order_id,
                    fee_amount: Math.round(excessAmount * 100) / 100,
                    booking_due_at_capture: outstanding,
                    amount_captured: amountInr,
                    system_generated: true,
                  },
                } as any);
              } catch (feeErr) {
                console.error("Razorpay fee split failed (non-blocking):", feeErr);
              }
            }

            await supabaseAdmin
              .from("razorpay_orders")
              .update({ status: "paid", captured_at: new Date().toISOString() } as any)
              .eq("order_id", razorpay_order_id);
          } else if (event === "payment.failed") {
            if (razorpay_order_id) {
              await supabaseAdmin
                .from("razorpay_orders")
                .update({ status: "failed" } as any)
                .eq("order_id", razorpay_order_id);
            }
          } else if (event === "order.paid") {
            if (razorpay_order_id) {
              await supabaseAdmin
                .from("razorpay_orders")
                .update({ status: "paid", captured_at: new Date().toISOString() } as any)
                .eq("order_id", razorpay_order_id);
            }
          }

          await supabaseAdmin
            .from("razorpay_webhook_events")
            .update({ processed_at: new Date().toISOString() } as any)
            .eq("event_id", event_id);

          return ok();
        } catch (e: any) {
          console.error("Razorpay webhook processing error:", e);
          await supabaseAdmin
            .from("razorpay_webhook_events")
            .update({ processing_error: String(e?.message || e) } as any)
            .eq("event_id", event_id);
          return err(500, "Processing error");
        }
      },
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
    },
  },
});
