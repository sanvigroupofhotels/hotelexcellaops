/**
 * Guest Portal — server functions
 *
 * - issueBookingToken (auth): creates / reuses a public payment link token for a booking
 * - getPortalBooking (public): looks up a booking summary by token (admin-elevated, scoped)
 * - createRazorpayOrder (public): creates a Razorpay order for the chosen payment intent
 * - recordPayAtHotelIntent (public): records a "pay at hotel" intent as a booking activity
 *
 * Razorpay webhook (server route) lives at /api/public/razorpay-webhook
 * and actually inserts booking_payments rows on `payment.captured`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TOKEN_TTL_DAYS = 30;

function randomToken(): string {
  // 32 hex chars, sufficient entropy for an unguessable share link
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// issueBookingToken (auth)
// ---------------------------------------------------------------------------
export const issueBookingToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ booking_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Reuse an existing non-revoked, non-expired token if present
    const { data: existing } = await supabase
      .from("booking_tokens" as any)
      .select("token, expires_at, revoked_at")
      .eq("booking_id", data.booking_id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const now = Date.now();
    const stillValid =
      existing && !(existing as any).revoked_at &&
      (!(existing as any).expires_at || new Date((existing as any).expires_at).getTime() > now);
    if (stillValid) return { token: (existing as any).token };

    const token = randomToken();
    const expires_at = new Date(now + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from("booking_tokens" as any).insert({
      booking_id: data.booking_id,
      token,
      scope: "pay",
      expires_at,
      user_id: userId,
    } as any);
    if (error) throw error;
    return { token };
  });

// ---------------------------------------------------------------------------
// getPortalBooking (public) — admin-elevated, but ONLY returns guest-safe fields
// ---------------------------------------------------------------------------
export const getPortalBooking = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(8).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: tok, error: tokErr } = await supabaseAdmin
      .from("booking_tokens")
      .select("booking_id, expires_at, revoked_at")
      .eq("token", data.token)
      .maybeSingle();
    if (tokErr) throw tokErr;
    if (!tok) throw new Error("Invalid link");
    if (tok.revoked_at) throw new Error("Link has been revoked");
    if (tok.expires_at && new Date(tok.expires_at).getTime() < Date.now()) throw new Error("Link has expired");

    // Best-effort last-accessed touch
    await supabaseAdmin
      .from("booking_tokens")
      .update({ last_accessed_at: new Date().toISOString() } as any)
      .eq("token", data.token);

    const { data: b, error: bErr } = await supabaseAdmin
      .from("bookings")
      .select(
        "id, booking_reference, guest_name, phone, check_in, check_out, room_type, guests, amount, advance_paid, balance_due, part_payment_type, part_payment_value, status, breakfast_included",
      )
      .eq("id", tok.booking_id)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!b) throw new Error("Booking not found");

    const total = Number((b as any).amount) || 0;
    const advance = Number((b as any).advance_paid) || 0;
    const balance = Math.max(0, Number((b as any).balance_due ?? total - advance) || 0);

    let minPartPayment = 0;
    const ptype = (b as any).part_payment_type as string | null;
    const pval = Number((b as any).part_payment_value) || 0;
    if (ptype === "fixed") minPartPayment = pval;
    else if (ptype === "percent") minPartPayment = Math.round((total * pval) / 100);

    return {
      reference: (b as any).booking_reference,
      guestName: (b as any).guest_name,
      checkIn: (b as any).check_in,
      checkOut: (b as any).check_out,
      roomType: (b as any).room_type,
      guests: (b as any).guests,
      breakfastIncluded: !!(b as any).breakfast_included,
      totalAmount: total,
      advancePaid: advance,
      balanceDue: balance,
      minPartPayment,
      status: (b as any).status,
    };
  });

// ---------------------------------------------------------------------------
// createRazorpayOrder (public)
// ---------------------------------------------------------------------------
export const createRazorpayOrder = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(8).max(128),
        amount: z.number().positive().max(10_000_000), // paise validated separately
        intent: z.enum(["full", "part"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error("Razorpay is not configured");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Validate token + booking
    const { data: tok } = await supabaseAdmin
      .from("booking_tokens")
      .select("booking_id, expires_at, revoked_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!tok || tok.revoked_at || (tok.expires_at && new Date(tok.expires_at).getTime() < Date.now())) {
      throw new Error("Link is invalid or expired");
    }
    const { data: b } = await supabaseAdmin
      .from("bookings")
      .select("id, amount, advance_paid, balance_due, booking_reference, guest_name, phone")
      .eq("id", tok.booking_id)
      .maybeSingle();
    if (!b) throw new Error("Booking not found");

    const balance = Math.max(
      0,
      Number((b as any).balance_due ?? Number((b as any).amount) - Number((b as any).advance_paid)) || 0,
    );
    if (balance <= 0) throw new Error("No balance due on this booking");
    const amount = Math.min(balance, Math.round(data.amount));
    if (amount <= 0) throw new Error("Amount must be greater than zero");

    const amountPaise = Math.round(amount * 100);
    const receipt = `bk_${(b as any).booking_reference || (b as any).id}`.slice(0, 40);

    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + btoa(`${keyId}:${keySecret}`),
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt,
        notes: {
          booking_id: (b as any).id,
          booking_reference: (b as any).booking_reference,
          intent: data.intent,
          token: data.token,
        },
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error("Razorpay order error:", res.status, txt);
      throw new Error("Could not initiate payment. Please try again.");
    }
    const order = (await res.json()) as { id: string; amount: number; currency: string };

    return {
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      bookingReference: (b as any).booking_reference,
      guestName: (b as any).guest_name,
      phone: (b as any).phone,
    };
  });

// ---------------------------------------------------------------------------
// recordPayAtHotelIntent (public) — soft signal only; no money moves
// ---------------------------------------------------------------------------
export const recordPayAtHotelIntent = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(8).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tok } = await supabaseAdmin
      .from("booking_tokens")
      .select("booking_id, revoked_at, expires_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!tok || tok.revoked_at || (tok.expires_at && new Date(tok.expires_at).getTime() < Date.now())) {
      throw new Error("Link is invalid or expired");
    }
    await supabaseAdmin.from("booking_activities" as any).insert({
      booking_id: tok.booking_id,
      actor_name: "Guest (Portal)",
      actor_role: "guest",
      action: "note",
      summary: "Guest selected: Pay at Hotel on check-in",
    } as any);
    return { ok: true };
  });
