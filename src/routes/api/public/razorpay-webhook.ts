/**
 * Razorpay webhook — receives payment events and credits booking_payments.
 *
 * URL: /api/public/razorpay-webhook  (configure in Razorpay dashboard)
 *
 * Security:
 *   - Verifies x-razorpay-signature header against RAZORPAY_WEBHOOK_SECRET
 *     using HMAC-SHA256 of the raw request body.
 *   - Only processes the `payment.captured` event.
 *
 * On payment.captured:
 *   - Looks up booking_id from order.notes.booking_id
 *   - Inserts a booking_payments row via supabaseAdmin
 *   - Existing DB triggers handle: advance_paid recompute, cashbook sync (cash only),
 *     payment activity audit, and booking status derivation.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

export const Route = createFileRoute("/api/public/razorpay-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) {
          console.error("RAZORPAY_WEBHOOK_SECRET not configured");
          return new Response("Server misconfigured", { status: 500 });
        }

        const signature = request.headers.get("x-razorpay-signature");
        const body = await request.text();
        if (!signature) return new Response("Missing signature", { status: 401 });

        const expected = createHmac("sha256", secret).update(body).digest("hex");
        try {
          const sig = Buffer.from(signature);
          const exp = Buffer.from(expected);
          if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
            return new Response("Invalid signature", { status: 401 });
          }
        } catch {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: any;
        try {
          payload = JSON.parse(body);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const event = payload?.event as string | undefined;
        if (event !== "payment.captured") {
          // Ignore other events but acknowledge to prevent retries
          return new Response("ok", { status: 200 });
        }

        const payment = payload?.payload?.payment?.entity;
        if (!payment) return new Response("Missing payment", { status: 400 });

        const notes = payment.notes || {};
        const booking_id = notes.booking_id as string | undefined;
        const token = notes.token as string | undefined;
        const amountPaise = Number(payment.amount) || 0;
        const amountInr = amountPaise / 100;
        const razorpay_payment_id = payment.id as string;

        if (!booking_id || amountInr <= 0) {
          console.error("Webhook missing booking_id or amount", { booking_id, amountInr });
          return new Response("Missing booking_id", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Idempotency: if we've already recorded this Razorpay payment id, skip.
        const { data: existing } = await supabaseAdmin
          .from("booking_payments")
          .select("id")
          .eq("booking_id", booking_id)
          .ilike("notes", `%${razorpay_payment_id}%`)
          .limit(1)
          .maybeSingle();
        if (existing) return new Response("ok", { status: 200 });

        // Get user_id from booking (required by RLS / NOT NULL)
        const { data: booking } = await supabaseAdmin
          .from("bookings")
          .select("user_id, customer_id")
          .eq("id", booking_id)
          .maybeSingle();
        if (!booking) return new Response("Booking not found", { status: 404 });

        const method = String(payment.method || "razorpay");
        const modeMap: Record<string, string> = {
          card: "Card",
          netbanking: "Bank Transfer",
          upi: "UPI",
          wallet: "UPI",
          emi: "Card",
        };
        const payment_mode = modeMap[method] || "UPI";

        const { error: insErr } = await supabaseAdmin.from("booking_payments").insert({
          booking_id,
          customer_id: (booking as any).customer_id,
          amount: amountInr,
          payment_mode,
          collected_by: "Guest Portal",
          occurred_at: new Date().toISOString(),
          notes: `Razorpay ${razorpay_payment_id}${token ? ` · token ${String(token).slice(0, 8)}…` : ""}`,
          user_id: (booking as any).user_id,
        } as any);
        if (insErr) {
          console.error("Failed to insert booking_payment from webhook:", insErr);
          return new Response("DB error", { status: 500 });
        }

        return new Response("ok", { status: 200 });
      },
      // Razorpay does not preflight, but a tolerant OPTIONS keeps debugging tools happy.
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, x-razorpay-signature",
          },
        }),
    },
  },
});
