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

async function ensurePortalToken(supabaseAdmin: any, bookingId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("booking_tokens")
    .select("token, expires_at, revoked_at")
    .eq("booking_id", bookingId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const now = Date.now();
  const stillValid =
    existing && !(existing as any).revoked_at &&
    (!(existing as any).expires_at || new Date((existing as any).expires_at).getTime() > now);
  if (stillValid) return (existing as any).token;

  // booking_tokens.user_id is NOT NULL — copy the booking's owner so public
  // lookups (mobile / reference search) can mint a token without an auth session.
  const { data: bRow, error: bErr } = await supabaseAdmin
    .from("bookings")
    .select("user_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (bErr) throw bErr;
  const ownerUserId = (bRow as any)?.user_id ?? null;
  if (!ownerUserId) {
    throw new Error("This booking is missing an owner and cannot be shared via portal. Ask an admin to assign it.");
  }

  const token = randomToken();
  const expires_at = new Date(now + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabaseAdmin.from("booking_tokens").insert({
    booking_id: bookingId,
    token,
    scope: "pay",
    expires_at,
    user_id: ownerUserId,
  } as any);
  if (error) throw error;
  return token;
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
// Accepts ANY ONE of: full URL/token, booking reference, or mobile number.
// Mobile lookups return the latest active booking directly, or a short
// selection list when multiple active bookings exist.
// ---------------------------------------------------------------------------
export const lookupPortalToken = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      reference: z.string().min(3).max(128).optional().or(z.literal("")),
      phone: z.string().min(6).max(32).optional().or(z.literal("")),
      query: z.string().min(3).max(256).optional().or(z.literal("")),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const raw = (data.query || data.reference || data.phone || "").trim();
    const NOT_FOUND = "We could not find an active booking matching those details.";
    if (!raw) throw new Error("Please enter a booking link, token, reference, or mobile number.");

    const tokenFromUrl = raw.replace(/^.*\/portal\//i, "").replace(/^.*\/(?=[a-f0-9]{16,})/i, "").split(/[?#]/)[0].trim();
    if (/^[a-f0-9]{16,64}$/i.test(tokenFromUrl)) {
      const { data: tok } = await supabaseAdmin
        .from("booking_tokens")
        .select("token, expires_at, revoked_at")
        .eq("token", tokenFromUrl)
        .maybeSingle();
      if (!tok || (tok as any).revoked_at || ((tok as any).expires_at && new Date((tok as any).expires_at).getTime() < Date.now())) {
        throw new Error("This portal link is invalid or expired.");
      }
      return { token: (tok as any).token, matches: [] };
    }

    const activeStatuses = ["Pending", "Confirmed", "Advance Paid", "Full Paid", "Checked-In", "Draft"] as const;
    const phoneDigits = raw.replace(/\D/g, "");
    const looksLikePhone = phoneDigits.length >= 6 && phoneDigits.length >= raw.replace(/[^a-z0-9]/gi, "").length - 2;

    if (looksLikePhone) {
      const last10 = phoneDigits.slice(-10);
      const { data: rows, error } = await supabaseAdmin
        .from("bookings")
        .select("id, booking_reference, guest_name, phone, check_in, check_out, room_details, guests, amount, status, created_at")
        .in("status", activeStatuses)
        .order("check_in", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      const matches = (rows ?? []).filter((b: any) => String(b.phone ?? "").replace(/\D/g, "").slice(-10) === last10);
      if (matches.length === 0) throw new Error(NOT_FOUND);
      const withTokens = await Promise.all(matches.map(async (b: any) => ({
        token: await ensurePortalToken(supabaseAdmin, b.id),
        reference: b.booking_reference,
        guestName: b.guest_name,
        checkIn: b.check_in,
        checkOut: b.check_out,
        roomType: b.room_details ?? "",
        guests: Number(b.guests ?? 0),
        amount: Number(b.amount ?? 0),
        status: b.status,
      })));
      if (withTokens.length === 1) return { token: withTokens[0].token, matches: [] };
      return { token: null, matches: withTokens };
    }

    const refTrim = raw.toUpperCase();
    const { data: b, error } = await supabaseAdmin
      .from("bookings")
      .select("id, status")
      .ilike("booking_reference", refTrim)
      .in("status", activeStatuses)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!b) throw new Error(NOT_FOUND);
    return { token: await ensurePortalToken(supabaseAdmin, (b as any).id), matches: [] };
  });

// ---------------------------------------------------------------------------
// getPortalBooking (public) — admin-elevated, but ONLY returns guest-safe fields
// ---------------------------------------------------------------------------
export const getPortalBooking = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: z.string().min(6).max(128) }).parse(input))
  .handler(async ({ data }) => {
    // UAT-030 — accepts token OR booking_reference. See resolvePortalRef.
    const { supabaseAdmin, booking: bookingLite, token: resolvedToken } =
      await resolvePortalRef(data.token);

    // Best-effort last-accessed touch (only when a token row exists).
    await supabaseAdmin
      .from("booking_tokens")
      .update({ last_accessed_at: new Date().toISOString() } as any)
      .eq("token", resolvedToken);

    const { data: b, error: bErr } = await supabaseAdmin
      .from("bookings")
      .select(
        "id, customer_id, booking_reference, guest_name, phone, email, check_in, check_out, room_details, guests, amount, advance_paid, subtotal, taxes, tax_rate, taxes_included, total_override, part_payment_type, part_payment_value, status, allow_full_payment, allow_part_payment, allow_pay_at_hotel, expected_arrival_at, emergency_contact_name, emergency_contact_phone, special_requests",
      )
      .eq("id", (bookingLite as any).id)
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
    const chargesTotal = charges.reduce((s: number, r: any) => s + r.amount, 0);

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

    // Booking line items — pull the full extras schema so we can itemise
    // Early Check-in / Late Check-out / Extra Adults / Drivers / Pet on the
    // Guest Portal. Mirrors what the shared Pricing Engine computes for the
    // Booking / Quote surfaces (src/lib/pricing.ts) so the portal reads the
    // same numbers the guest was invoiced.
    const { data: itemRows } = await supabaseAdmin
      .from("booking_items")
      .select("subtotal, rate, rooms, check_in, check_out, early_check_in, early_check_in_slot, late_check_out, late_check_out_slot, pet_size, extra_adults, drivers")
      .eq("booking_id", (b as any).id);
    const rows = (itemRows ?? []) as any[];

    const nightsOf = (ci: string, co: string) =>
      Math.max(1, Math.round((new Date(co).getTime() - new Date(ci).getTime()) / 86400000));
    const EARLY: Record<string, number | null> = { "10-13": 500, "8-10": 750, "6-8": 1000, "before-6": null };
    const LATE:  Record<string, number | null> = { "upto-2pm": 500, "2-4pm": 1000, "after-4pm": null };
    const PET:   Record<string, number> = { none: 0, small: 750, medium: 750, large: 1000 };
    const EARLY_LBL: Record<string, string> = { "10-13": "10 AM – 1 PM", "8-10": "8 AM – 10 AM", "6-8": "6 AM – 8 AM", "before-6": "Before 6 AM (full day)" };
    const LATE_LBL:  Record<string, string> = { "upto-2pm": "Up to 2 PM", "2-4pm": "2 PM – 4 PM", "after-4pm": "After 4 PM (full day)" };
    const EXTRA_ADULT = 500, DRIVER = 500;

    const roomChargesFromRows = rows.reduce((s: number, r: any) => {
      const n = nightsOf(r.check_in, r.check_out);
      const rms = Math.max(1, Number(r.rooms) || 1);
      return s + (Number(r.rate) || 0) * n * rms;
    }, 0);
    const extrasAgg: Record<string, number> = {};
    const push = (label: string, val: number) => { if (val > 0) extrasAgg[label] = (extrasAgg[label] || 0) + val; };
    for (const r of rows) {
      const n = nightsOf(r.check_in, r.check_out);
      const rms = Math.max(1, Number(r.rooms) || 1);
      const rate = Number(r.rate) || 0;
      if (r.early_check_in && r.early_check_in_slot) {
        const fee = EARLY[r.early_check_in_slot];
        push(`Early Check-in (${EARLY_LBL[r.early_check_in_slot] ?? r.early_check_in_slot})`, (fee != null ? fee : rate) * rms);
      }
      if (r.late_check_out && r.late_check_out_slot) {
        const fee = LATE[r.late_check_out_slot];
        push(`Late Check-out (${LATE_LBL[r.late_check_out_slot] ?? r.late_check_out_slot})`, (fee != null ? fee : rate) * rms);
      }
      const petFee = PET[r.pet_size ?? "none"] ?? 0;
      if (petFee > 0) push(`Pet Stay (${r.pet_size}) · ${n}N`, petFee * n);
      if ((r.extra_adults || 0) > 0) push(`Extra Guest × ${r.extra_adults} · ${n}N`, r.extra_adults * EXTRA_ADULT * n);
      if ((r.drivers || 0) > 0) push(`Drivers × ${r.drivers} · ${n}N`, r.drivers * DRIVER * n);
    }
    const additionalLineItems = Object.entries(extrasAgg).map(([label, value]) => ({ label, value }));
    const roomCharges = roomChargesFromRows > 0
      ? roomChargesFromRows
      : rows.reduce((s: number, r: any) => s + Number(r.subtotal || 0), 0);

    const total = Number((b as any).amount) || 0;
    const subtotal = Number((b as any).subtotal) || 0;
    const taxes = Number((b as any).taxes) || 0;
    const taxRate = Number((b as any).tax_rate) || 0;
    const taxesIncluded = !!(b as any).taxes_included;
    const advance = Number((b as any).advance_paid) || 0;
    const payable = total + chargesTotal;
    const balance = ((b as any).status === "Cancelled" || (b as any).status === "No-Show") ? 0 : Math.max(0, payable - advance);
    const additionalStay = additionalLineItems.reduce((s, x) => s + x.value, 0);
    const itemsTotal = rows.reduce((s: number, r: any) => s + Number(r.subtotal || 0), 0);
    const discount = Math.max(0, itemsTotal - subtotal);

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
      additionalLineItems,
      discount,
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
    // UAT-030 — resolves token OR booking_reference.
    const { supabaseAdmin, booking: tokBooking } = await resolvePortalRef(data.token);
    const customerId = (tokBooking as any)?.customer_id ?? null;
    const bookingId = (tokBooking as any).id as string;

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
        .eq("id", bookingId);
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
      booking_id: bookingId,
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
//
// - Validates the portal token and computes the true payable balance server-side
//   (never trusts the client amount — clamped to the balance).
// - Reuses an existing OPEN razorpay_orders row for the same booking + intent
//   + amount when present, so a browser refresh / retry doesn't spawn duplicate
//   Razorpay orders. This is Razorpay's recommended one-open-order-per-intent
//   pattern.
// - Persists every order in `razorpay_orders` for reconciliation.
// ---------------------------------------------------------------------------
export const createRazorpayOrder = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(8).max(128),
        amount: z.number().positive().max(10_000_000),
        intent: z.enum(["full", "part"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error("Razorpay is not configured");

    // UAT-030 — resolves token OR booking_reference to the underlying
    // booking. `resolvedToken` is the internal token we key razorpay_orders
    // rows on so webhook reconciliation still works.
    const { supabaseAdmin, booking: bLite, token: resolvedToken } =
      await resolvePortalRef(data.token);
    const { data: b } = await supabaseAdmin
      .from("bookings")
      .select("id, amount, advance_paid, booking_reference, guest_name, phone, status")
      .eq("id", (bLite as any).id)
      .maybeSingle();
    if (!b) throw new Error("Booking not found");
    if ((b as any).status === "Cancelled" || (b as any).status === "No-Show") {
      throw new Error("This booking is closed. Please contact reception.");
    }

    const { data: chargeRows } = await supabaseAdmin
      .from("booking_charges").select("amount").eq("booking_id", (b as any).id);
    const chargesTotal = (chargeRows ?? []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

    const payable = Number((b as any).amount) + chargesTotal;
    const balance = Math.max(0, payable - Number((b as any).advance_paid || 0));
    if (balance <= 0) throw new Error("No balance due on this booking");
    const amount = Math.min(balance, Math.round(data.amount));
    if (amount <= 0) throw new Error("Amount must be greater than zero");
    const amountPaise = Math.round(amount * 100);

    // Reuse an existing OPEN order for the same booking + intent + amount.
    const { data: reusable } = await supabaseAdmin
      .from("razorpay_orders")
      .select("order_id, amount_paise, currency, status")
      .eq("booking_id", (b as any).id)
      .eq("intent", data.intent)
      .eq("amount_paise", amountPaise)
      .in("status", ["created", "attempted"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let orderId: string;
    let orderAmount: number;
    let orderCurrency: string;

    if (reusable) {
      orderId = (reusable as any).order_id;
      orderAmount = Number((reusable as any).amount_paise);
      orderCurrency = (reusable as any).currency ?? "INR";
    } else {
      const receipt = `bk_${(b as any).booking_reference || (b as any).id}_${Date.now().toString(36)}`.slice(0, 40);
      const orderNotes = {
        booking_id: (b as any).id,
        booking_reference: (b as any).booking_reference,
        intent: data.intent,
        token: resolvedToken,
      };
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
          notes: orderNotes,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        console.error("Razorpay order error:", res.status, txt);
        throw new Error("Could not initiate payment. Please try again.");
      }
      const order = (await res.json()) as { id: string; amount: number; currency: string };
      orderId = order.id;
      orderAmount = order.amount;
      orderCurrency = order.currency;

      const { error: insErr } = await supabaseAdmin.from("razorpay_orders").insert({
        booking_id: (b as any).id,
        token: resolvedToken,
        intent: data.intent,
        order_id: orderId,
        amount_paise: amountPaise,
        currency: orderCurrency,
        receipt,
        notes: orderNotes,
      } as any);
      if (insErr && !String(insErr.message || "").toLowerCase().includes("duplicate")) {
        console.error("razorpay_orders insert failed:", insErr);
      }
    }

    return {
      keyId,
      orderId,
      amount: orderAmount,
      currency: orderCurrency,
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
    const { supabaseAdmin, booking } = await resolvePortalRef(data.token);
    await supabaseAdmin.from("booking_activities" as any).insert({
      booking_id: (booking as any).id,
      actor_name: "Guest (Portal)",
      actor_role: "guest",
      action: "note",
      notes: "Guest selected: Pay at Hotel on check-in",
    } as any);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// confirmRazorpayPayment (public) — client-side confirmation fallback.
//
// Razorpay's checkout.js handler returns razorpay_order_id / payment_id /
// signature. We verify HMAC_SHA256(order_id|payment_id, key_secret) === signature
// and, if valid, insert a booking_payments row.
//
// Idempotency is enforced by a UNIQUE INDEX on booking_payments.razorpay_payment_id.
// A concurrent webhook cannot double-credit — one of the two inserts loses on
// the unique index and returns "already recorded".
//
// This complements the dashboard webhook so payments are never lost if the
// webhook is misconfigured or delayed. Booking confirmation is driven by
// the DB trigger that recomputes advance_paid / derives status.
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

    // Verify checkout signature — timing-safe.
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

    // UAT-030 — resolves token OR booking_reference.
    const { supabaseAdmin, booking: tokBk } = await resolvePortalRef(data.token);
    const tok = { booking_id: (tokBk as any).id };

    // Fast-path idempotency: if we've already inserted this razorpay_payment_id,
    // just return. The unique index is still the ultimate guard below.
    const { data: existing } = await supabaseAdmin
      .from("booking_payments")
      .select("id")
      .eq("razorpay_payment_id", data.razorpay_payment_id)
      .limit(1)
      .maybeSingle();
    if (existing) {
      await supabaseAdmin
        .from("razorpay_orders")
        .update({ status: "paid", captured_at: new Date().toISOString() } as any)
        .eq("order_id", data.razorpay_order_id);
      return { ok: true, alreadyRecorded: true };
    }

    // Fetch payment details from Razorpay to get authoritative amount/method/status.
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

    const { error: insErr } = await supabaseAdmin.from("booking_payments").insert({
      booking_id: (tok as any).booking_id,
      customer_id: (booking as any).customer_id,
      amount: amountInr,
      payment_mode: "Razorpay",
      collected_by: "Guest Portal",
      occurred_at: new Date().toISOString(),
      notes: `Razorpay ${data.razorpay_payment_id}`,
      user_id: (booking as any).user_id,
      razorpay_order_id: data.razorpay_order_id,
      razorpay_payment_id: data.razorpay_payment_id,
      razorpay_signature: data.razorpay_signature,
      razorpay_method: payment.method ?? null,
    } as any);
    if (insErr) {
      // 23505 = unique_violation → the webhook beat us to it. Treat as success.
      if ((insErr as any).code === "23505" || String(insErr.message || "").toLowerCase().includes("duplicate")) {
        await supabaseAdmin
          .from("razorpay_orders")
          .update({ status: "paid", captured_at: new Date().toISOString() } as any)
          .eq("order_id", data.razorpay_order_id);
        return { ok: true, alreadyRecorded: true };
      }
      console.error("confirmRazorpayPayment insert failed", insErr);
      throw new Error("Could not record payment");
    }

    // Mark the order as paid (best-effort; webhook may also update).
    await supabaseAdmin
      .from("razorpay_orders")
      .update({ status: "paid", captured_at: new Date().toISOString() } as any)
      .eq("order_id", data.razorpay_order_id);

    return { ok: true, alreadyRecorded: false };
  });


// ===========================================================================
// Guest Portal — Documents, Cancellation, Complaint, Review (Batch B)
// ===========================================================================

const GUEST_DOC_BUCKET = "guest-documents";

/**
 * v1.1 UAT-030 — Portal accepts EITHER a booking-scoped token (32-char hex,
 * legacy shareable link) OR a booking reference (e.g. HEXB-FA5AE5, the
 * clean human-friendly URL).
 *
 * Resolution order:
 *   1. Try booking_tokens.token exact match (legacy behaviour).
 *   2. If not found, treat the input as a booking_reference (uppercased),
 *      look up the booking, and auto-mint/reuse a portal token internally
 *      so downstream operations (order creation, activity logs) still have
 *      a token to key off. The guest never sees the token — the URL stays
 *      as the booking reference throughout.
 *
 * Both paths return the same {supabaseAdmin, booking, token} shape so
 * callers are agnostic. Token in return value is always the resolved
 * internal token (needed by createRazorpayOrder which stores it on
 * razorpay_orders rows).
 */
async function resolvePortalRef(input: string): Promise<{
  supabaseAdmin: any; booking: any; token: string;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Missing portal reference");

  // Path 1: token lookup.
  const { data: tok } = await supabaseAdmin
    .from("booking_tokens")
    .select("booking_id, revoked_at, expires_at, token")
    .eq("token", raw)
    .maybeSingle();
  if (tok) {
    if ((tok as any).revoked_at) throw new Error("Link has been revoked");
    if ((tok as any).expires_at && new Date((tok as any).expires_at).getTime() < Date.now()) {
      throw new Error("Link has expired");
    }
    const { data: b } = await supabaseAdmin
      .from("bookings")
      .select("id, user_id, customer_id, check_in, advance_paid, status, booking_reference, guest_name")
      .eq("id", (tok as any).booking_id)
      .maybeSingle();
    if (!b) throw new Error("Booking not found");
    return { supabaseAdmin, booking: b as any, token: (tok as any).token };
  }

  // Path 2: booking_reference lookup. References are stored uppercase.
  const ref = raw.toUpperCase();
  const { data: b } = await supabaseAdmin
    .from("bookings")
    .select("id, user_id, customer_id, check_in, advance_paid, status, booking_reference, guest_name")
    .eq("booking_reference", ref)
    .maybeSingle();
  if (!b) throw new Error("This booking link is invalid or expired.");
  const mintedToken = await ensurePortalToken(supabaseAdmin, (b as any).id);
  return { supabaseAdmin, booking: b as any, token: mintedToken };
}

// Legacy alias — kept so downstream call-sites don't churn.
async function tokenToBooking(token: string) {
  const { supabaseAdmin, booking } = await resolvePortalRef(token);
  return { supabaseAdmin, booking };
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
    return (rows ?? [])
      .filter((r: any) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .map((r: any) => ({
        id: r.id,
        booking_id: r.booking_id,
        customer_id: r.customer_id,
        doc_type: r.doc_type,
        front_path: r.front_path ? "__on_file__" : null,
        back_path: null,
        selfie_path: null,
        notes: null,
        source: r.source,
        uploaded_by_name: r.uploaded_by_name,
        uploaded_at: r.uploaded_at,
        verified_at: r.verified_at,
      }));
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
    // Notification Engine fan-out — direct insert via admin since this
    // runs server-side in a public route (no authenticated user context).
    try {
      const stars = "★".repeat(Math.max(1, Math.min(5, data.rating)));
      await supabaseAdmin.from("notifications" as any).insert({
        type: "review_received",
        title: `New Guest Review · ${stars}`,
        body: [
          `Guest: ${booking.guest_name ?? "—"}`,
          `Rating: ${data.rating}/5`,
          data.comment ? `Comment: ${String(data.comment).slice(0, 240)}` : null,
          route === "external" ? "Guest invited to Google review." : null,
        ].filter(Boolean).join("\n"),
        entity_type: "review",
        entity_id: null,
        entity_reference: String(data.rating),
        priority: data.rating <= 2 ? "high" : "normal",
        audience_role: "operations",
        user_id: null,
        status: "unread",
        metadata: { booking_id: booking.id, rating: data.rating },
      });
    } catch (e) { console.warn("[portal] review notification emit failed", e); }
    return { ok: true, route, externalReviewUrl: route === "external" ? externalUrl : null };
  });
