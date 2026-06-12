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
        "id, customer_id, booking_reference, guest_name, phone, email, check_in, check_out, room_details, guests, amount, advance_paid, part_payment_type, part_payment_value, status, allow_full_payment, allow_part_payment, allow_pay_at_hotel, expected_arrival_at, emergency_contact_name, emergency_contact_phone, special_requests",
      )
      .eq("id", tok.booking_id)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!b) throw new Error("Booking not found");

    // Emergency contact lives on the customer record (single source of truth).
    // Fallback to legacy booking-level value if customer not yet linked / not set.
    let ecName = "";
    let ecPhone = "";
    if ((b as any).customer_id) {
      const { data: cust } = await supabaseAdmin
        .from("customers")
        .select("emergency_contact_name, emergency_contact_phone")
        .eq("id", (b as any).customer_id)
        .maybeSingle();
      ecName = (cust as any)?.emergency_contact_name ?? "";
      ecPhone = (cust as any)?.emergency_contact_phone ?? "";
    }
    if (!ecName) ecName = (b as any).emergency_contact_name ?? "";
    if (!ecPhone) ecPhone = (b as any).emergency_contact_phone ?? "";

    // Pull in-house charges total to surface in the portal balance
    const { data: charges } = await supabaseAdmin
      .from("booking_charges")
      .select("amount")
      .eq("booking_id", (b as any).id);
    const chargesTotal = (charges ?? []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

    const total = Number((b as any).amount) || 0;
    const advance = Number((b as any).advance_paid) || 0;
    const payable = total + chargesTotal;
    const balance = Math.max(0, payable - advance);

    let minPartPayment = 0;
    const ptype = (b as any).part_payment_type as string | null;
    const pval = Number((b as any).part_payment_value) || 0;
    if (ptype === "fixed") minPartPayment = pval;
    else if (ptype === "percent") minPartPayment = Math.round((payable * pval) / 100);

    return {
      bookingId: (b as any).id,
      reference: (b as any).booking_reference,
      guestName: (b as any).guest_name,
      phone: (b as any).phone ?? "",
      email: (b as any).email ?? "",
      checkIn: (b as any).check_in,
      checkOut: (b as any).check_out,
      roomType: (b as any).room_details ?? "",
      guests: (b as any).guests,
      breakfastIncluded: false,
      totalAmount: total,
      chargesTotal,
      payable,
      advancePaid: advance,
      balanceDue: balance,
      minPartPayment,
      status: (b as any).status,
      allowFullPayment: (b as any).allow_full_payment !== false,
      allowPartPayment: (b as any).allow_part_payment !== false,
      allowPayAtHotel: (b as any).allow_pay_at_hotel !== false,
      defaultPartPercent: ptype === "percent" ? pval : 0,
      expectedArrivalAt: (b as any).expected_arrival_at ?? null,
      emergencyContactName: ecName,
      emergencyContactPhone: ecPhone,
      specialRequests: (b as any).special_requests ?? "",
    };
  });

// ---------------------------------------------------------------------------
// updateGuestPortalDetails (public) — guest updates their own fields via token
// ---------------------------------------------------------------------------
export const updateGuestPortalDetails = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      token: z.string().min(8).max(128),
      guest_name: z.string().trim().min(1).max(120).optional(),
      phone: z.string().trim().min(7).max(20).regex(/^[+0-9 ()-]+$/).optional(),
      email: z.string().trim().email().max(255).optional().or(z.literal("")),
      expected_arrival_at: z.string().datetime().optional().or(z.literal("")),
      emergency_contact_name: z.string().trim().max(120).optional().or(z.literal("")),
      emergency_contact_phone: z.string().trim().max(20).regex(/^[+0-9 ()-]*$/).optional().or(z.literal("")),
      special_requests: z.string().trim().max(2000).optional().or(z.literal("")),
    }).parse(input),
  )
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
    // Resolve linked customer for emergency-contact write-through
    const { data: bRow } = await supabaseAdmin
      .from("bookings")
      .select("customer_id")
      .eq("id", tok.booking_id)
      .maybeSingle();
    const customerId = (bRow as any)?.customer_id ?? null;

    const patch: Record<string, any> = {};
    const customerPatch: Record<string, any> = {};
    const changes: string[] = [];
    if (data.guest_name !== undefined) { patch.guest_name = data.guest_name; customerPatch.guest_name = data.guest_name; changes.push("Name"); }
    if (data.phone !== undefined) { patch.phone = data.phone; customerPatch.phone = data.phone; changes.push("Mobile"); }
    if (data.email !== undefined) { patch.email = data.email || null; customerPatch.email = data.email || null; changes.push("Email"); }
    if (data.expected_arrival_at !== undefined) {
      patch.expected_arrival_at = data.expected_arrival_at || null;
      changes.push("Expected Arrival");
    }
    if (data.emergency_contact_name !== undefined) {
      // Source of truth is customers; keep booking column in sync for backward compatibility.
      customerPatch.emergency_contact_name = data.emergency_contact_name || null;
      patch.emergency_contact_name = data.emergency_contact_name || null;
      changes.push("Emergency Contact Name");
    }
    if (data.emergency_contact_phone !== undefined) {
      customerPatch.emergency_contact_phone = data.emergency_contact_phone || null;
      patch.emergency_contact_phone = data.emergency_contact_phone || null;
      changes.push("Emergency Contact Mobile");
    }
    if (data.special_requests !== undefined) {
      patch.special_requests = data.special_requests || null;
      changes.push("Special Requests");
    }
    if (Object.keys(patch).length === 0 && Object.keys(customerPatch).length === 0) return { ok: true };

    if (Object.keys(patch).length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from("bookings")
        .update(patch as any)
        .eq("id", tok.booking_id);
      if (upErr) throw upErr;
    }

    if (customerId && Object.keys(customerPatch).length > 0) {
      // Don't overwrite customer name/phone/email if they're empty strings (already covered) — patch only sent fields.
      await supabaseAdmin
        .from("customers")
        .update(customerPatch as any)
        .eq("id", customerId);
    }

    await supabaseAdmin.from("booking_activities" as any).insert({
      booking_id: tok.booking_id,
      actor_name: "Guest (Portal)",
      actor_role: "guest",
      action: "note",
      notes: `Guest updated: ${changes.join(", ")}`,
      metadata: patch,
    } as any);
    return { ok: true };
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
      .select("id, amount, advance_paid, booking_reference, guest_name, phone")
      .eq("id", tok.booking_id)
      .maybeSingle();
    if (!b) throw new Error("Booking not found");

    const { data: chargeRows } = await supabaseAdmin
      .from("booking_charges").select("amount").eq("booking_id", (b as any).id);
    const chargesTotal = (chargeRows ?? []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

    const payable = Number((b as any).amount) + chargesTotal;
    const balance = Math.max(0, payable - Number((b as any).advance_paid || 0));
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
      notes: "Guest selected: Pay at Hotel on check-in",
    } as any);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// confirmRazorpayPayment (public) — client-side confirmation fallback.
// Razorpay's checkout.js handler returns razorpay_order_id / payment_id /
// signature. We verify HMAC_SHA256(order_id|payment_id, key_secret) === signature
// and, if valid, insert a booking_payments row. Idempotent on razorpay_payment_id.
// This complements the dashboard webhook so payments are never lost if the
// webhook is misconfigured or delayed.
// ---------------------------------------------------------------------------
export const confirmRazorpayPayment = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      token: z.string().min(8).max(128),
      razorpay_order_id: z.string().min(4).max(128),
      razorpay_payment_id: z.string().min(4).max(128),
      razorpay_signature: z.string().min(8).max(256),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keySecret || !keyId) throw new Error("Razorpay is not configured");

    // Verify checkout signature
    const { createHmac, timingSafeEqual } = await import("crypto");
    const expected = createHmac("sha256", keySecret)
      .update(`${data.razorpay_order_id}|${data.razorpay_payment_id}`)
      .digest("hex");
    const sig = Buffer.from(data.razorpay_signature);
    const exp = Buffer.from(expected);
    if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
      console.error("Razorpay confirm: signature mismatch", {
        order: data.razorpay_order_id, payment: data.razorpay_payment_id,
      });
      throw new Error("Payment signature verification failed");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Validate token + booking
    const { data: tok } = await supabaseAdmin
      .from("booking_tokens")
      .select("booking_id, revoked_at, expires_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!tok || tok.revoked_at || (tok.expires_at && new Date(tok.expires_at).getTime() < Date.now())) {
      throw new Error("Link is invalid or expired");
    }

    // Idempotency — if we've already inserted this razorpay_payment_id, do nothing.
    const { data: existing } = await supabaseAdmin
      .from("booking_payments")
      .select("id")
      .eq("booking_id", (tok as any).booking_id)
      .ilike("notes", `%${data.razorpay_payment_id}%`)
      .limit(1)
      .maybeSingle();
    if (existing) return { ok: true, alreadyRecorded: true };

    // Fetch payment details from Razorpay to get authoritative amount/method
    const fetchRes = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(data.razorpay_payment_id)}`,
      { headers: { Authorization: "Basic " + btoa(`${keyId}:${keySecret}`) } },
    );
    if (!fetchRes.ok) {
      const txt = await fetchRes.text();
      console.error("Razorpay payment fetch failed", fetchRes.status, txt);
      throw new Error("Could not verify payment with Razorpay");
    }
    const payment = await fetchRes.json() as {
      id: string; amount: number; status: string; method?: string; order_id: string;
    };
    if (payment.status !== "captured" && payment.status !== "authorized") {
      throw new Error(`Payment not captured (status: ${payment.status})`);
    }
    if (payment.order_id !== data.razorpay_order_id) {
      throw new Error("Order/payment mismatch");
    }
    const amountInr = Number(payment.amount) / 100;

    const { data: booking } = await supabaseAdmin
      .from("bookings")
      .select("user_id, customer_id")
      .eq("id", (tok as any).booking_id)
      .maybeSingle();
    if (!booking) throw new Error("Booking not found");

    const modeMap: Record<string, string> = {
      card: "Card", netbanking: "Bank Transfer", upi: "UPI", wallet: "UPI", emi: "Card",
    };
    const payment_mode = modeMap[String(payment.method || "")] || "UPI";

    const { error: insErr } = await supabaseAdmin.from("booking_payments").insert({
      booking_id: (tok as any).booking_id,
      customer_id: (booking as any).customer_id,
      amount: amountInr,
      payment_mode,
      collected_by: "Guest Portal",
      occurred_at: new Date().toISOString(),
      notes: `Razorpay ${data.razorpay_payment_id}`,
      user_id: (booking as any).user_id,
    } as any);
    if (insErr) {
      console.error("confirmRazorpayPayment insert failed", insErr);
      throw new Error("Could not record payment");
    }
    return { ok: true, alreadyRecorded: false };
  });
