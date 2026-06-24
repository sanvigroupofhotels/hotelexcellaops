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
// lookupPortalToken (public) — guest self-service "Find my booking"
// Match requires BOTH booking_reference AND mobile to prevent enumeration.
// Mints (or reuses) a portal token and returns it.
// ---------------------------------------------------------------------------
export const lookupPortalToken = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      reference: z.string().min(3).max(64),
      phone: z.string().min(6).max(32),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const refTrim = data.reference.trim().toUpperCase();
    // Normalise phone to digits-only; tolerate +91 / 0 / spaces / dashes
    const phoneDigits = data.phone.replace(/\D/g, "");
    if (phoneDigits.length < 6) throw new Error("Please enter a valid mobile number.");

    const { data: b } = await supabaseAdmin
      .from("bookings")
      .select("id, phone, status")
      .ilike("booking_reference", refTrim)
      .maybeSingle();
    // Generic message — do not reveal whether the reference or the phone failed.
    const NOT_FOUND = "We could not find a booking matching that reference and mobile number.";
    if (!b) throw new Error(NOT_FOUND);
    const onFile = String((b as any).phone ?? "").replace(/\D/g, "");
    // Match last 10 digits to tolerate country-code variations.
    if (!onFile || onFile.slice(-10) !== phoneDigits.slice(-10)) {
      throw new Error(NOT_FOUND);
    }
    if ((b as any).status === "Cancelled") {
      throw new Error("This booking has been cancelled. Please contact reception.");
    }

    // Reuse an active token if available
    const { data: existing } = await supabaseAdmin
      .from("booking_tokens")
      .select("token, expires_at, revoked_at")
      .eq("booking_id", (b as any).id)
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
    const { error } = await supabaseAdmin.from("booking_tokens").insert({
      booking_id: (b as any).id,
      token,
      scope: "pay",
      expires_at,
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
        "id, customer_id, booking_reference, guest_name, phone, email, check_in, check_out, room_details, guests, amount, advance_paid, subtotal, taxes, tax_rate, taxes_included, total_override, part_payment_type, part_payment_value, status, allow_full_payment, allow_part_payment, allow_pay_at_hotel, expected_arrival_at, emergency_contact_name, emergency_contact_phone, special_requests",
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

    // Pull in-house charges (full breakdown) + total
    const { data: chargeRows } = await supabaseAdmin
      .from("booking_charges")
      .select("id, category, other_description, quantity, unit_price, amount, occurred_at")
      .eq("booking_id", (b as any).id)
      .order("occurred_at", { ascending: true });
    const charges = (chargeRows ?? []).map((r: any) => ({
      id: r.id,
      category: r.category,
      description: r.other_description ?? "",
      quantity: Number(r.quantity ?? 1),
      unitPrice: Number(r.unit_price ?? 0),
      amount: Number(r.amount ?? 0),
    }));
    const chargesTotal = charges.reduce((s, r) => s + r.amount, 0);

    // Assigned room number (first active assignment)
    let roomNumber = "";
    try {
      const { data: asgn } = await supabaseAdmin
        .from("booking_room_assignments")
        .select("rooms ( room_number )")
        .eq("booking_id", (b as any).id)
        .limit(1)
        .maybeSingle();
      roomNumber = (asgn as any)?.rooms?.room_number ?? "";
    } catch { /* ignore */ }

    // Booking line items (separate room charges from extras)
    const { data: itemRows } = await supabaseAdmin
      .from("booking_items")
      .select("subtotal")
      .eq("booking_id", (b as any).id);
    const roomCharges = (itemRows ?? []).reduce((s: number, r: any) => s + Number(r.subtotal || 0), 0);

    const total = Number((b as any).amount) || 0;
    const subtotal = Number((b as any).subtotal) || 0;
    const taxes = Number((b as any).taxes) || 0;
    const taxRate = Number((b as any).tax_rate) || 0;
    const taxesIncluded = !!(b as any).taxes_included;
    const advance = Number((b as any).advance_paid) || 0;
    const payable = total + chargesTotal;
    const balance = ((b as any).status === "Cancelled" || (b as any).status === "No-Show") ? 0 : Math.max(0, payable - advance);
    // Stay extras = stay subtotal beyond the pure room charges line(s)
    const additionalStay = Math.max(0, subtotal - roomCharges);

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
      roomNumber,
      guests: (b as any).guests,
      breakfastIncluded: false,
      totalAmount: total,
      // Detailed breakdown
      subtotal,
      taxes,
      taxRate,
      taxesIncluded,
      roomCharges,
      additionalStay,
      chargesTotal,
      charges,
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
      phone: z.string().trim().regex(/^\+91\d{10}$/, "Please enter a valid mobile number.").optional(),
      email: z.string().trim().email().max(255).optional().or(z.literal("")),
      expected_arrival_at: z.string().datetime().optional().or(z.literal("")),
      emergency_contact_name: z.string().trim().max(120).optional().or(z.literal("")),
      emergency_contact_phone: z.string().trim().regex(/^(\+91\d{10})?$/, "Please enter a valid mobile number.").optional().or(z.literal("")),
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

    const payment_mode = "Razorpay";

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

// ===========================================================================
// Guest Portal — Documents, Cancellation, Complaint, Review (Batch B)
// ===========================================================================

const GUEST_DOC_BUCKET = "guest-documents";

async function tokenToBooking(token: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: tok } = await supabaseAdmin
    .from("booking_tokens")
    .select("booking_id, revoked_at, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!tok || (tok as any).revoked_at || ((tok as any).expires_at && new Date((tok as any).expires_at).getTime() < Date.now())) {
    throw new Error("Link is invalid or expired");
  }
  const { data: b } = await supabaseAdmin
    .from("bookings")
    .select("id, user_id, customer_id, check_in, advance_paid, status, booking_reference, guest_name")
    .eq("id", (tok as any).booking_id)
    .maybeSingle();
  if (!b) throw new Error("Booking not found");
  return { supabaseAdmin, booking: b as any };
}

// --- listPortalDocuments -----------------------------------------------------
export const listPortalDocuments = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(8).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin, booking } = await tokenToBooking(data.token);
    const filters: string[] = [`booking_id.eq.${booking.id}`];
    if (booking.customer_id) filters.push(`customer_id.eq.${booking.customer_id}`);
    const { data: rows, error } = await supabaseAdmin
      .from("guest_documents")
      .select("*")
      .or(filters.join(","))
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false });
    if (error) throw error;
    const seen = new Set<string>();
    return (rows ?? []).filter((r: any) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  });

// --- signPortalDocumentUrl ---------------------------------------------------
export const signPortalDocumentUrl = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ token: z.string().min(8).max(128), path: z.string().min(1).max(512) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, booking } = await tokenToBooking(data.token);
    // The path must reference a document attached to this booking or its customer.
    const { data: rows } = await supabaseAdmin
      .from("guest_documents")
      .select("id, booking_id, customer_id, front_path, back_path, selfie_path")
      .or([
        `booking_id.eq.${booking.id}`,
        ...(booking.customer_id ? [`customer_id.eq.${booking.customer_id}`] : []),
      ].join(","));
    const ok = (rows ?? []).some((r: any) =>
      r.front_path === data.path || r.back_path === data.path || r.selfie_path === data.path,
    );
    if (!ok) throw new Error("File not found");
    const { data: signed, error } = await supabaseAdmin.storage
      .from(GUEST_DOC_BUCKET)
      .createSignedUrl(data.path, 300);
    if (error || !signed) throw new Error("Could not generate file link");
    return { url: signed.signedUrl };
  });

// --- uploadPortalDocument ----------------------------------------------------
// Files are passed as { name, mime, base64 } chunks. ID photos are small enough.
const FileBlob = z.object({
  name: z.string().min(1).max(200),
  mime: z.string().min(1).max(120),
  base64: z.string().min(8).max(8_000_000), // ~6MB binary cap
}).optional().nullable();

export const uploadPortalDocument = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      token: z.string().min(8).max(128),
      doc_type: z.enum(["Aadhaar", "PAN", "Passport", "Driving License", "Other"]),
      notes: z.string().max(2000).optional().default(""),
      front: FileBlob,
      back: FileBlob,
      selfie: FileBlob,
      uploaded_by_name: z.string().max(200).optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, booking } = await tokenToBooking(data.token);
    if (!data.front && !data.back && !data.selfie) {
      throw new Error("Please choose at least one file to upload");
    }
    // Determine if existing doc already has a Front
    const { data: existing } = await supabaseAdmin
      .from("guest_documents")
      .select("front_path")
      .or([
        `booking_id.eq.${booking.id}`,
        ...(booking.customer_id ? [`customer_id.eq.${booking.customer_id}`] : []),
      ].join(","))
      .is("deleted_at", null);
    const hasExistingFront = (existing ?? []).some((r: any) => !!r.front_path);
    if (!data.front && !hasExistingFront) throw new Error("Front side is mandatory");

    const insertRes = await supabaseAdmin
      .from("guest_documents")
      .insert({
        booking_id: booking.id,
        customer_id: booking.customer_id ?? null,
        doc_type: data.doc_type,
        notes: data.notes || null,
        uploaded_by: null,
        uploaded_by_name: data.uploaded_by_name || booking.guest_name || "Guest (Portal)",
        source: "Guest Portal",
        user_id: booking.user_id,
      } as any)
      .select()
      .single();
    if (insertRes.error) throw insertRes.error;
    const row = insertRes.data as any;

    const scope = booking.id;
    const patch: Record<string, string> = {};
    const upload = async (kind: "front" | "back" | "selfie", blob: { name: string; mime: string; base64: string } | null | undefined) => {
      if (!blob) return;
      const extMatch = blob.name.match(/\.([a-z0-9]+)$/i);
      const ext = (extMatch?.[1] || (blob.mime.split("/")[1] ?? "jpg")).toLowerCase();
      const bin = Buffer.from(blob.base64, "base64");
      const path = `${scope}/${row.id}/${kind}.${ext}`;
      const { error } = await supabaseAdmin.storage
        .from(GUEST_DOC_BUCKET)
        .upload(path, bin, { upsert: true, cacheControl: "3600", contentType: blob.mime || "image/jpeg" });
      if (error) throw error;
      patch[`${kind}_path`] = path;
    };
    try {
      await upload("front", data.front ?? null);
      await upload("back", data.back ?? null);
      await upload("selfie", data.selfie ?? null);
    } catch (e) {
      await supabaseAdmin.from("guest_documents").delete().eq("id", row.id);
      throw e;
    }
    if (Object.keys(patch).length > 0) {
      const { data: updated, error } = await supabaseAdmin
        .from("guest_documents").update(patch as any).eq("id", row.id).select().single();
      if (error) throw error;
      return updated;
    }
    return row;
  });

// --- softDeletePortalDocument -----------------------------------------------
export const softDeletePortalDocument = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ token: z.string().min(8).max(128), doc_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, booking } = await tokenToBooking(data.token);
    const { data: doc } = await supabaseAdmin
      .from("guest_documents")
      .select("id, booking_id, customer_id")
      .eq("id", data.doc_id)
      .maybeSingle();
    if (!doc) throw new Error("Document not found");
    const owns =
      (doc as any).booking_id === booking.id ||
      (booking.customer_id && (doc as any).customer_id === booking.customer_id);
    if (!owns) throw new Error("Not allowed");
    const { error } = await supabaseAdmin
      .from("guest_documents")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by_name: booking.guest_name || "Guest (Portal)",
      } as any)
      .eq("id", data.doc_id);
    if (error) throw error;
    return { ok: true };
  });

// --- cancelPortalBooking -----------------------------------------------------
export const cancelPortalBooking = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(8).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin, booking } = await tokenToBooking(data.token);
    if (["Cancelled", "Checked-In", "Checked-Out", "Stay Completed", "No-Show"].includes(booking.status)) {
      throw new Error("This booking cannot be cancelled from the portal. Please contact reception.");
    }
    if (Number(booking.advance_paid || 0) > 0) {
      throw new Error("Payment already recorded — please contact reception to cancel your booking.");
    }
    // Cut-off: now <= check-in 14:00 IST - 24h
    const checkInIso = `${booking.check_in}T14:00:00+05:30`;
    const cutoff = new Date(checkInIso).getTime() - 24 * 60 * 60 * 1000;
    if (Date.now() > cutoff) {
      throw new Error("Cancellation window closed (within 24h of check-in) — please contact reception.");
    }
    const { error } = await supabaseAdmin
      .from("bookings")
      .update({
        status: "Cancelled",
        cancel_reason: "Guest self-cancelled (Guest Portal)",
      } as any)
      .eq("id", booking.id);
    if (error) throw error;
    await supabaseAdmin.from("booking_activities" as any).insert({
      booking_id: booking.id,
      actor_name: "Guest (Portal)",
      actor_role: "guest",
      action: "cancelled",
      notes: "Booking cancelled by guest via portal",
    } as any);
    return { ok: true };
  });

// --- submitPortalComplaint --------------------------------------------------
export const submitPortalComplaint = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      token: z.string().min(8).max(128),
      category: z.string().min(1).max(120),
      description: z.string().min(3).max(4000),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, booking } = await tokenToBooking(data.token);
    const { error } = await supabaseAdmin.from("complaints" as any).insert({
      user_id: booking.user_id,
      complaint_type: "General",
      booking_id: booking.id,
      customer_id: booking.customer_id ?? null,
      category: data.category,
      priority: "Medium",
      status: "Open",
      entered_by_name: `${booking.guest_name || "Guest"} (Portal)`,
      description: data.description,
      issue_type: "Guest Complaint",
      guest_impacted: true,
    } as any);
    if (error) throw error;
    return { ok: true };
  });

// --- listPortalComplaints ---------------------------------------------------
export const listPortalComplaints = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(8).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin, booking } = await tokenToBooking(data.token);
    const { data: rows, error } = await supabaseAdmin
      .from("complaints" as any)
      .select("id, category, status, description, created_at, complaint_number")
      .eq("booking_id", booking.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return ((rows ?? []) as unknown) as Array<{
      id: string; category: string; status: string; description: string;
      created_at: string; complaint_number?: string | null;
    }>;
  });

// --- submitPortalReview ------------------------------------------------------
const DEFAULT_EXTERNAL_REVIEW_URL = "https://search.google.com/local/writereview?placeid=ChIJH-C8eTZbOToRDi7ckoJipcQ";

export const submitPortalReview = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      token: z.string().min(8).max(128),
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(4000).optional().default(""),
      feedback_what_went_wrong: z.string().max(4000).optional().default(""),
      feedback_additional_comments: z.string().max(4000).optional().default(""),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, booking } = await tokenToBooking(data.token);
    // Read external review URL setting (best-effort)
    let externalUrl = DEFAULT_EXTERNAL_REVIEW_URL;
    try {
      const { data: row } = await supabaseAdmin
        .from("app_settings")
        .select("value")
        .eq("key", "external_review_url")
        .maybeSingle();
      const v = (row as any)?.value;
      if (typeof v === "string" && v.startsWith("http")) externalUrl = v;
      else if (v && typeof v === "object" && typeof v.url === "string") externalUrl = v.url;
    } catch { /* ignore */ }

    const route = data.rating >= 4 ? "external" : "feedback";
    const { error } = await supabaseAdmin.from("guest_reviews" as any).insert({
      booking_id: booking.id,
      customer_id: booking.customer_id ?? null,
      rating: data.rating,
      comment: data.comment || null,
      feedback_what_went_wrong: data.feedback_what_went_wrong || null,
      feedback_additional_comments: data.feedback_additional_comments || null,
      guest_name: booking.guest_name,
      source: "Guest Portal",
      routed_to_external: route === "external",
      would_recommend: data.rating >= 4,
      is_public: false,
    } as any);
    if (error) throw error;
    return { ok: true, route, externalReviewUrl: route === "external" ? externalUrl : null };
  });
