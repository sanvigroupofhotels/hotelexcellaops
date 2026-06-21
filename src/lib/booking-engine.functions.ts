/**
 * Booking Engine (book.hotelexcella.in) — public server functions.
 *
 * All functions here are unauthenticated and rely on Zod input validation +
 * supabaseAdmin for controlled writes. Reads use admin so we can compose
 * availability across rooms/rates/overrides without RLS friction.
 *
 * Phase 1 MVP: single-room, room-type level inventory, Razorpay + Pay-at-Hotel.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { normalizeOrThrow } from "@/lib/phone";


const DRAFT_TTL_MIN = 15;
const SOURCE = "BookingEngine";

function nightsBetween(check_in: string, check_out: string): number {
  const a = new Date(check_in + "T00:00:00").getTime();
  const b = new Date(check_out + "T00:00:00").getTime();
  return Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

function isWeekendISO(iso: string): boolean {
  const d = new Date(iso + "T00:00:00").getDay();
  return d === 5 || d === 6;
}

function genReference(): string {
  // BE-YYMMDD-XXXX
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BE-${yy}${mm}${dd}-${rnd}`;
}

function randomToken(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ----------------------------------------------------------------------------
// getEngineConfig — branding + payment toggles + tax + room types catalog
// ----------------------------------------------------------------------------
export const getEngineConfig = createServerFn({ method: "GET" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: settingRows } = await supabaseAdmin
      .from("app_settings")
      .select("key,value");

    const settings: Record<string, any> = {};
    for (const r of (settingRows ?? []) as any[]) settings[r.key] = r.value ?? {};

    const hotel = settings.hotel ?? {};
    const branding = settings.branding ?? {};
    const ops = settings.ops ?? {};
    const payment = settings.payment_settings ?? {};
    const tax = settings.tax ?? {};

    // Room catalogue: group active rooms by type, get default rate from room_rates
    const [{ data: rooms }, { data: rates }] = await Promise.all([
      supabaseAdmin.from("rooms").select("id,room_type,active").eq("active", true),
      supabaseAdmin.from("room_rates").select("room_type,default_rate,weekday_rate,weekend_rate"),
    ]);

    const byType: Record<string, { type: string; count: number }> = {};
    for (const r of (rooms ?? []) as any[]) {
      if (!byType[r.room_type]) byType[r.room_type] = { type: r.room_type, count: 0 };
      byType[r.room_type].count++;
    }
    const ratesByType: Record<string, any> = {};
    for (const r of (rates ?? []) as any[]) ratesByType[r.room_type] = r;

    const roomTypes = Object.values(byType).map((t) => ({
      type: t.type,
      total_rooms: t.count,
      default_rate: Number(ratesByType[t.type]?.default_rate ?? 0),
      weekday_rate: Number(ratesByType[t.type]?.weekday_rate ?? ratesByType[t.type]?.default_rate ?? 0),
      weekend_rate: Number(ratesByType[t.type]?.weekend_rate ?? ratesByType[t.type]?.default_rate ?? 0),
    }));

    return {
      hotel: {
        name: hotel.name ?? "Hotel Excella",
        logo_url: hotel.logo_url ?? "",
        address: hotel.address ?? "",
        phone: hotel.phone ?? "",
        email: hotel.email ?? "",
        gstin: hotel.gstin ?? "",
      },
      branding: {
        welcome_message: branding.welcome_message ?? "",
        hero_image_url: branding.hero_image_url ?? "",
      },
      ops: {
        check_in_time: ops.check_in_time ?? "13:00",
        check_out_time: ops.check_out_time ?? "11:00",
      },
      payment: {
        allow_full_payment: payment.allow_full_payment !== false,
        allow_part_payment: payment.allow_part_payment !== false,
        allow_pay_at_hotel: payment.allow_pay_at_hotel !== false,
        default_part_percent: Number(payment.default_part_percent ?? 25),
      },
      tax_rate: Number(tax.rate ?? 0.05),
      room_types: roomTypes,
    };
  });

// ----------------------------------------------------------------------------
// getAvailability — for a date range, returns per-type availability + pricing
// ----------------------------------------------------------------------------
export const getAvailability = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      guests: z.number().int().min(1).max(10).default(2),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    if (data.check_out <= data.check_in) {
      throw new Error("Check-out must be after check-in.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const nights = nightsBetween(data.check_in, data.check_out);

    const [{ data: rooms }, { data: rates }, { data: overrides }, { data: settingRows }, { data: bookingRows }, { data: maintRows }] =
      await Promise.all([
        supabaseAdmin.from("rooms").select("id,room_type").eq("active", true),
        supabaseAdmin.from("room_rates").select("room_type,default_rate,weekday_rate,weekend_rate"),
        supabaseAdmin.from("rate_overrides").select("room_type,date,rate").gte("date", data.check_in).lt("date", data.check_out),
        supabaseAdmin.from("app_settings").select("key,value").eq("key", "tax"),
        supabaseAdmin
          .from("bookings")
          .select("room_id,room_details,check_in,check_out,status,draft_expires_at")
          .lt("check_in", data.check_out)
          .gt("check_out", data.check_in),
        supabaseAdmin
          .from("room_maintenance")
          .select("room_id,start_date,end_date,active")
          .eq("active", true)
          .lt("start_date", data.check_out)
          .gt("end_date", data.check_in),
      ]);

    const tax_rate = Number(((settingRows ?? [])[0]?.value as any)?.rate ?? 0.05);

    // Group active rooms by type
    const roomsByType: Record<string, number> = {};
    const totalRoomsByType: Record<string, number> = {};
    for (const r of (rooms ?? []) as any[]) {
      totalRoomsByType[r.room_type] = (totalRoomsByType[r.room_type] || 0) + 1;
    }

    // Count blocked rooms per type (maintenance)
    const blockedRoomIds = new Set<string>();
    for (const m of (maintRows ?? []) as any[]) blockedRoomIds.add(m.room_id);

    // Count occupied rooms per type
    // "Occupied" = any booking whose status holds inventory and overlaps.
    // Already-expired drafts are excluded.
    const OCCUPIED_STATUSES = new Set([
      "Pending", "Confirmed", "Advance Paid", "Full Paid", "Checked-In", "Draft",
    ]);
    const occupiedRoomIds = new Set<string>(); // by specific room id (legacy)
    const occupiedByType: Record<string, number> = {};
    const nowMs = Date.now();
    for (const b of (bookingRows ?? []) as any[]) {
      if (!OCCUPIED_STATUSES.has(b.status)) continue;
      if (b.status === "Draft" && b.draft_expires_at && new Date(b.draft_expires_at).getTime() < nowMs) continue;
      if (b.room_id) {
        occupiedRoomIds.add(b.room_id);
      } else if (b.room_details) {
        occupiedByType[b.room_details] = (occupiedByType[b.room_details] || 0) + 1;
      }
    }
    // Add blocked-rooms tally per type
    const blockedByType: Record<string, number> = {};
    for (const r of (rooms ?? []) as any[]) {
      if (blockedRoomIds.has(r.id)) blockedByType[r.room_type] = (blockedByType[r.room_type] || 0) + 1;
      if (occupiedRoomIds.has(r.id)) occupiedByType[r.room_type] = (occupiedByType[r.room_type] || 0) + 1;
    }

    // Compute availability per type
    for (const t of Object.keys(totalRoomsByType)) {
      const total = totalRoomsByType[t] || 0;
      const occ = occupiedByType[t] || 0;
      const blk = blockedByType[t] || 0;
      roomsByType[t] = Math.max(0, total - occ - blk);
    }

    // Build per-type pricing.
    // NOTE: rooms.room_type may differ from room_rates.room_type by the trailing
    // " Room" suffix (e.g. rooms="Oak", rates="Oak Room"). Probe both forms.
    const ratesByType: Record<string, any> = {};
    for (const r of (rates ?? []) as any[]) ratesByType[r.room_type] = r;
    const pickRates = (type: string) =>
      ratesByType[type] ??
      ratesByType[`${type} Room`] ??
      ratesByType[type.replace(/\s+Room$/i, "")] ??
      {};
    const pickRateKey = (type: string): string =>
      ratesByType[type] ? type
        : ratesByType[`${type} Room`] ? `${type} Room`
        : ratesByType[type.replace(/\s+Room$/i, "")] ? type.replace(/\s+Room$/i, "")
        : type;
    const overridesByKey: Record<string, number> = {};
    for (const o of (overrides ?? []) as any[]) overridesByKey[`${o.room_type}|${o.date}`] = Number(o.rate);

    const results = Object.keys(totalRoomsByType).map((type) => {
      const r = pickRates(type);
      const rateKey = pickRateKey(type);
      const displayType = /\bRoom\b/i.test(type) ? type : `${type} Room`;
      const nightly: { date: string; rate: number }[] = [];
      let subtotal = 0;
      for (let i = 0; i < nights; i++) {
        const d = new Date(data.check_in + "T00:00:00");
        d.setDate(d.getDate() + i);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        let rate = overridesByKey[`${rateKey}|${iso}`] ?? overridesByKey[`${type}|${iso}`];
        if (rate == null) {
          if (isWeekendISO(iso)) rate = Number(r.weekend_rate ?? r.default_rate ?? 0);
          else rate = Number(r.weekday_rate ?? r.default_rate ?? 0);
        }
        nightly.push({ date: iso, rate });
        subtotal += rate;
      }
      const taxes = Math.round(subtotal * tax_rate);
      const total = subtotal + taxes;
      return {
        type: displayType,
        room_type_key: type,
        available: roomsByType[type] ?? 0,
        total_rooms: totalRoomsByType[type] ?? 0,
        nights,
        nightly,
        subtotal,
        tax_rate,
        taxes,
        total,
      };
    }).sort((a, b) => a.subtotal - b.subtotal);

    return { nights, results };
  });

// ----------------------------------------------------------------------------
// Helper: pick a system user_id (the first admin)
// ----------------------------------------------------------------------------
async function getSystemUserId(): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
  if (!data?.user_id) throw new Error("No admin user available for booking engine attribution");
  return data.user_id;
}

// ----------------------------------------------------------------------------
// createDraftBooking — holds inventory for 15 minutes
// ----------------------------------------------------------------------------
export const createDraftBooking = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      room_type: z.string().min(1).max(80),
      check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      guests: z.number().int().min(1).max(10),
      guest_name: z.string().trim().min(2).max(120),
      phone: z.string().trim().regex(/^\+?\d{10,14}$/i, "Please enter a valid mobile number"),
      email: z.string().trim().email().max(255).optional().or(z.literal("")),
      special_requests: z.string().trim().max(2000).optional().or(z.literal("")),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Canonicalize phone so Lead.phone == Customer.phone == Booking.phone everywhere.
    const phone = normalizeOrThrow(data.phone);

    if (data.check_out <= data.check_in) throw new Error("Check-out must be after check-in.");


    // Re-check availability for the chosen type
    const nights = nightsBetween(data.check_in, data.check_out);

    // Resolve type against both forms: "Oak" vs "Oak Room"
    const typeIn = data.room_type;
    const typeStripped = typeIn.replace(/\s+Room$/i, "");
    const typeCandidates = Array.from(new Set([typeIn, typeStripped, `${typeStripped} Room`]));

    const [{ data: rooms }, { data: ratesAll }, { data: overrides }, { data: bookingRows }, { data: maintRows }, { data: settingRows }] =
      await Promise.all([
        supabaseAdmin.from("rooms").select("id,room_type").eq("active", true).in("room_type", typeCandidates),
        supabaseAdmin.from("room_rates").select("*").in("room_type", typeCandidates),
        supabaseAdmin.from("rate_overrides").select("room_type,date,rate").in("room_type", typeCandidates).gte("date", data.check_in).lt("date", data.check_out),
        supabaseAdmin
          .from("bookings")
          .select("room_id,room_details,check_in,check_out,status,draft_expires_at")
          .lt("check_in", data.check_out)
          .gt("check_out", data.check_in),
        supabaseAdmin
          .from("room_maintenance")
          .select("room_id,active,start_date,end_date")
          .eq("active", true)
          .lt("start_date", data.check_out)
          .gt("end_date", data.check_in),
        supabaseAdmin.from("app_settings").select("value").eq("key", "tax").maybeSingle(),
      ]);

    const rates = (ratesAll ?? [])[0] ?? null;
    const roomsRoomType = (rooms ?? [])[0]?.room_type ?? typeStripped;

    const tax_rate = Number((settingRows as any)?.value?.rate ?? 0.05);
    const totalOfType = (rooms ?? []).length;
    if (totalOfType === 0) throw new Error("That room type is no longer available.");

    const OCCUPIED = new Set(["Pending", "Confirmed", "Advance Paid", "Full Paid", "Checked-In", "Draft"]);
    const nowMs = Date.now();
    const blockedRoomIds = new Set<string>(((maintRows ?? []) as any[]).map((m) => m.room_id));
    let occupied = 0;
    const occupiedRoomIds = new Set<string>();
    for (const b of (bookingRows ?? []) as any[]) {
      if (!OCCUPIED.has(b.status)) continue;
      if (b.status === "Draft" && b.draft_expires_at && new Date(b.draft_expires_at).getTime() < nowMs) continue;
      if (b.room_id) occupiedRoomIds.add(b.room_id);
      else if (b.room_details === data.room_type || b.room_details === roomsRoomType) occupied++;
    }
    for (const r of (rooms ?? []) as any[]) {
      if (occupiedRoomIds.has(r.id) || blockedRoomIds.has(r.id)) occupied++;
    }
    const available = Math.max(0, totalOfType - occupied);
    if (available <= 0) throw new Error("Sorry, the last room of this type was just booked. Please try different dates or another room.");

    // Price the stay
    const r = (rates ?? {}) as any;
    let subtotal = 0;
    for (let i = 0; i < nights; i++) {
      const d = new Date(data.check_in + "T00:00:00");
      d.setDate(d.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const ovr = (overrides ?? []).find((o: any) => o.date === iso);
      let rate: number;
      if (ovr) rate = Number((ovr as any).rate);
      else if (isWeekendISO(iso)) rate = Number(r.weekend_rate ?? r.default_rate ?? 0);
      else rate = Number(r.weekday_rate ?? r.default_rate ?? 0);
      subtotal += rate;
    }
    const taxes = Math.round(subtotal * tax_rate);
    const total = subtotal + taxes;

    if (total <= 0) throw new Error("Pricing unavailable for the selected dates. Please contact the hotel.");

    const systemUserId = await getSystemUserId();

    // Find or create customer (by normalized phone). Lead capture (Step A) may
    // have already created a customer via the leads_link_or_create_customer
    // trigger using the normalized phone, so we MUST query in the same shape.
    let customerId: string | null = null;
    const { data: existingCust } = await supabaseAdmin
      .from("customers").select("id").eq("phone", phone).limit(1).maybeSingle();
    if (existingCust) customerId = (existingCust as any).id;
    else {
      const { data: newCust, error: ce } = await supabaseAdmin
        .from("customers").insert({
          user_id: systemUserId,
          guest_name: data.guest_name,
          phone,
          email: data.email || null,
          lead_source: "Direct",
        } as any).select("id").single();
      if (ce) throw ce;
      customerId = (newCust as any).id;
    }

    const reference = genReference();
    const draftExpires = new Date(Date.now() + DRAFT_TTL_MIN * 60_000).toISOString();

    const { data: ins, error: bErr } = await supabaseAdmin.from("bookings").insert({
      user_id: systemUserId,
      customer_id: customerId,
      booking_reference: reference,
      guest_name: data.guest_name,
      phone,

      email: data.email || null,
      check_in: data.check_in,
      check_out: data.check_out,
      adults: data.guests,
      guests: data.guests,
      room_details: data.room_type,
      amount: total,
      subtotal,
      taxes,
      tax_rate,
      status: "Draft",
      source_channel: SOURCE,
      lead_source: "Booking Engine",
      special_requests: data.special_requests || null,
      draft_expires_at: draftExpires,
      pay_at_hotel: false,
      notes: `Created from Booking Engine`,
    } as any).select("id, booking_reference").single();
    if (bErr) throw bErr;

    return {
      booking_id: (ins as any).id,
      reference: (ins as any).booking_reference,
      total,
      subtotal,
      taxes,
      tax_rate,
      nights,
      draft_expires_at: draftExpires,
    };
  });

// ----------------------------------------------------------------------------
// createBookingEngineOrder — Razorpay order for a draft booking
// ----------------------------------------------------------------------------
export const createBookingEngineOrder = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      booking_id: z.string().uuid(),
      intent: z.enum(["full", "part"]).default("full"),
      amount: z.number().positive().max(10_000_000),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error("Payments are not configured. Please choose Pay at Hotel.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: b } = await supabaseAdmin
      .from("bookings")
      .select("id,booking_reference,guest_name,phone,amount,advance_paid,status,draft_expires_at,source_channel")
      .eq("id", data.booking_id).maybeSingle();
    if (!b) throw new Error("Booking not found");
    if ((b as any).source_channel !== SOURCE) throw new Error("Invalid booking source");
    if ((b as any).status !== "Draft") throw new Error("This booking is no longer in draft state");
    if ((b as any).draft_expires_at && new Date((b as any).draft_expires_at).getTime() < Date.now()) {
      throw new Error("Your 15-minute hold has expired. Please start again.");
    }

    const balance = Math.max(0, Number((b as any).amount) - Number((b as any).advance_paid || 0));
    const amount = Math.min(balance, Math.round(data.amount));
    if (amount <= 0) throw new Error("Amount must be greater than zero");

    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + btoa(`${keyId}:${keySecret}`),
      },
      body: JSON.stringify({
        amount: amount * 100,
        currency: "INR",
        receipt: `be_${(b as any).booking_reference}`.slice(0, 40),
        notes: {
          booking_id: (b as any).id,
          booking_reference: (b as any).booking_reference,
          intent: data.intent,
          source: SOURCE,
        },
      }),
    });
    if (!res.ok) {
      console.error("Razorpay order error", await res.text());
      throw new Error("Could not initiate payment. Please try again.");
    }
    const order = await res.json() as { id: string; amount: number; currency: string };

    await supabaseAdmin.from("bookings").update({ gateway_order_id: order.id } as any).eq("id", (b as any).id);

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

// ----------------------------------------------------------------------------
// confirmBookingEnginePayment — verify Razorpay signature, mark booking paid
// ----------------------------------------------------------------------------
export const confirmBookingEnginePayment = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      booking_id: z.string().uuid(),
      razorpay_order_id: z.string().min(4).max(128),
      razorpay_payment_id: z.string().min(4).max(128),
      razorpay_signature: z.string().min(8).max(256),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) throw new Error("Payments are not configured");

    const { createHmac, timingSafeEqual } = await import("crypto");
    const expected = createHmac("sha256", keySecret)
      .update(`${data.razorpay_order_id}|${data.razorpay_payment_id}`)
      .digest("hex");
    const sig = Buffer.from(data.razorpay_signature);
    const exp = Buffer.from(expected);
    if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
      throw new Error("Invalid payment signature");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Fetch payment to get exact amount
    const keyId = process.env.RAZORPAY_KEY_ID!;
    const payRes = await fetch(`https://api.razorpay.com/v1/payments/${data.razorpay_payment_id}`, {
      headers: { Authorization: "Basic " + btoa(`${keyId}:${keySecret}`) },
    });
    if (!payRes.ok) throw new Error("Could not verify payment");
    const pay = await payRes.json() as { amount: number; status: string };
    const amountInr = Number(pay.amount) / 100;

    const { data: b } = await supabaseAdmin
      .from("bookings")
      .select("id,user_id,customer_id,booking_reference,amount,status,source_channel")
      .eq("id", data.booking_id).maybeSingle();
    if (!b) throw new Error("Booking not found");

    // Idempotency
    const { data: existingPay } = await supabaseAdmin
      .from("booking_payments").select("id").eq("booking_id", (b as any).id)
      .ilike("notes", `%${data.razorpay_payment_id}%`).maybeSingle();

    if (!existingPay) {
      const { error: pe } = await supabaseAdmin.from("booking_payments").insert({
        booking_id: (b as any).id,
        customer_id: (b as any).customer_id,
        amount: amountInr,
        payment_mode: "Razorpay",
        collected_by: "Booking Engine",
        occurred_at: new Date().toISOString(),
        notes: `Razorpay ${data.razorpay_payment_id}`,
        user_id: (b as any).user_id,
      } as any);
      if (pe) throw pe;
    }

    // Promote Draft → derived status (trigger derives Advance Paid / Full Paid)
    // Move out of Draft first so the derive trigger runs.
    await supabaseAdmin.from("bookings").update({
      status: "Pending",
      draft_expires_at: null,
      gateway_payment_id: data.razorpay_payment_id,
      gateway_order_id: data.razorpay_order_id,
    } as any).eq("id", (b as any).id);

    // Issue portal token
    const token = randomToken();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin.from("booking_tokens").insert({
      booking_id: (b as any).id, token, scope: "pay", expires_at: expires, user_id: (b as any).user_id,
    } as any);

    return { reference: (b as any).booking_reference, token };
  });

// ----------------------------------------------------------------------------
// confirmPayAtHotel — finalize draft without payment
// ----------------------------------------------------------------------------
export const confirmPayAtHotel = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    booking_id: z.string().uuid(),
    pay_later: z.boolean().optional(),
  }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: b } = await supabaseAdmin
      .from("bookings")
      .select("id,user_id,booking_reference,status,source_channel,draft_expires_at,amount,subtotal,taxes,notes")
      .eq("id", data.booking_id).maybeSingle();
    if (!b) throw new Error("Booking not found");
    if ((b as any).source_channel !== SOURCE) throw new Error("Invalid booking source");
    if ((b as any).status !== "Draft") throw new Error("This booking is no longer in draft state");
    if ((b as any).draft_expires_at && new Date((b as any).draft_expires_at).getTime() < Date.now()) {
      throw new Error("Your 15-minute hold has expired. Please start again.");
    }

    const update: Record<string, any> = {
      status: "Confirmed",
      payment_status: "Pending Payment",
      pay_at_hotel: true,
      draft_expires_at: null,
    };
    // Apply 5% Pay-at-Hotel surcharge on top of the inventory price.
    if (data.pay_later) {
      const baseAmount = Number((b as any).amount) || 0;
      const baseSub = Number((b as any).subtotal) || 0;
      const newAmount = Math.round(baseAmount * 1.05);
      const newSub = Math.round(baseSub * 1.05);
      const newTax = Math.max(0, newAmount - newSub);
      update.amount = newAmount;
      update.subtotal = newSub;
      update.taxes = newTax;
      const note = `Pay-at-Hotel surcharge (5%) applied. Inventory total ₹${baseAmount} → Payable ₹${newAmount}.`;
      update.notes = ((b as any).notes ? (b as any).notes + "\n" : "") + note;
    }

    await supabaseAdmin.from("bookings").update(update as any).eq("id", (b as any).id);

    const token = randomToken();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin.from("booking_tokens").insert({
      booking_id: (b as any).id, token, scope: "pay", expires_at: expires, user_id: (b as any).user_id,
    } as any);

    return { reference: (b as any).booking_reference, token };
  });

// ----------------------------------------------------------------------------
// getConfirmation — fetch booking + token by reference for the confirmation page
// ----------------------------------------------------------------------------
export const getConfirmation = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ reference: z.string().min(4).max(40) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: b } = await supabaseAdmin
      .from("bookings")
      .select("id, booking_reference, guest_name, phone, email, check_in, check_out, room_details, guests, amount, advance_paid, status, pay_at_hotel, source_channel")
      .eq("booking_reference", data.reference)
      .eq("source_channel", SOURCE)
      .maybeSingle();
    if (!b) throw new Error("Booking not found");

    const { data: tok } = await supabaseAdmin
      .from("booking_tokens").select("token").eq("booking_id", (b as any).id)
      .is("revoked_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();

    return {
      reference: (b as any).booking_reference,
      guestName: (b as any).guest_name,
      phone: (b as any).phone,
      email: (b as any).email,
      checkIn: (b as any).check_in,
      checkOut: (b as any).check_out,
      roomType: (b as any).room_details,
      guests: (b as any).guests,
      amount: Number((b as any).amount),
      advancePaid: Number((b as any).advance_paid || 0),
      payAtHotel: !!(b as any).pay_at_hotel,
      status: (b as any).status,
      token: (tok as any)?.token ?? null,
    };
  });

// ----------------------------------------------------------------------------
// getDraftPricing — lightweight read of a draft booking's pricing
// Used by Step 4 (Review) to display Pay Now / Pay Later amounts.
// ----------------------------------------------------------------------------
export const getDraftPricing = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ booking_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: b } = await supabaseAdmin
      .from("bookings")
      .select("id,amount,subtotal,taxes,booking_reference,status,draft_expires_at,room_details,check_in,check_out,guests,source_channel")
      .eq("id", data.booking_id).maybeSingle();
    if (!b) throw new Error("Booking not found");
    if ((b as any).source_channel !== SOURCE) throw new Error("Invalid booking source");
    return {
      amount: Number((b as any).amount) || 0,
      subtotal: Number((b as any).subtotal) || 0,
      taxes: Number((b as any).taxes) || 0,
      reference: (b as any).booking_reference,
      status: (b as any).status,
      draft_expires_at: (b as any).draft_expires_at,
      room_type: (b as any).room_details,
      check_in: (b as any).check_in,
      check_out: (b as any).check_out,
      guests: (b as any).guests,
    };
  });
