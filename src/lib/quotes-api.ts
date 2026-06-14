import { supabase } from "@/integrations/supabase/client";
import { normalizePhoneNumber, validatePhoneNumber, phoneToWaDigits } from "@/lib/phone";
import {
  EARLY_CHECK_IN_SLOTS,
  LATE_CHECK_OUT_SLOTS,
  EXTRA_ADULT_RATE,
  DRIVER_RATE,
  EXTRA_BREAKFAST_RATE,
  PET_RATES,
  getRoomRate,
  earlyCheckInLabel,
  lateCheckOutLabel,
  type EarlyCheckInSlot,
  type LateCheckOutSlot,
  type PetSize,
  type QuoteStatus,
  type PaymentStatus,
} from "@/lib/mock-data";

export const TAX_RATE = 0.05;

export interface QuoteInput {
  guest_name: string;
  phone: string;
  email?: string | null;
  lead_source?: string;
  group_size?: string;
  special_requests?: string | null;
  check_in: string; // YYYY-MM-DD
  check_out: string;
  room_type: string;
  rooms: number;
  /** Legacy column kept for compatibility — UI uses extra_adults instead. */
  extra_bed: number;
  // Counts
  adults: number;
  guests: number;
  children: number;
  // Policy fields
  early_check_in: boolean;
  early_check_in_slot?: EarlyCheckInSlot | null;
  late_check_out: boolean;
  late_check_out_slot?: LateCheckOutSlot | null;
  pet_charges: boolean;
  pet_size: PetSize;
  extra_adults: number;
  drivers: number;
  breakfast_included: boolean;
  extra_breakfast_guests: number;
  discount: number;
  internal_notes?: string | null;
  // CRM
  payment_status: PaymentStatus;
  booking_probability: number;
  lost_reason?: string | null;
  // Override parity with Bookings
  total_override?: number | null;
  taxes_included?: boolean;
}

export interface QuoteRow extends QuoteInput {
  id: string;
  reference_code: string;
  user_id: string;
  customer_id: string | null;
  status: QuoteStatus;
  nights: number;
  room_rate: number;
  subtotal: number;
  taxes: number;
  total: number;
  created_at: string;
  updated_at: string;
}

export function validateQuoteInput(input: QuoteInput) {
  if (!input.guest_name?.trim()) throw new Error("Guest name is required");
  if (!input.phone?.trim()) throw new Error("Phone is required");
  const normPhone = normalizePhoneNumber(input.phone);
  if (!validatePhoneNumber(normPhone))
    throw new Error("Please enter a valid mobile number.");
  input.phone = normPhone;
  if (input.email && input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
    throw new Error("Email looks invalid");
  if (!input.check_in || !input.check_out) throw new Error("Stay dates are required");
  if (new Date(input.check_out) <= new Date(input.check_in))
    throw new Error("Check-out must be after check-in");
  if (input.rooms < 1) throw new Error("At least 1 room is required");
  if (input.adults < 1) throw new Error("At least 1 adult is required");
  if (input.guests < input.adults) throw new Error("Guests cannot be less than adults");
  if (input.extra_adults < 0) throw new Error("Extra adults cannot be negative");
  if (input.drivers < 0) throw new Error("Drivers cannot be negative");
  if (input.discount < 0) throw new Error("Discount cannot be negative");
  if (input.early_check_in && !input.early_check_in_slot)
    throw new Error("Select an early check-in time slot");
  if (input.late_check_out && !input.late_check_out_slot)
    throw new Error("Select a late check-out time slot");
  if (input.breakfast_included && input.extra_breakfast_guests > 0)
    throw new Error("Extra breakfast guests only apply when breakfast is not included");
  if (!input.breakfast_included && input.extra_breakfast_guests < 0)
    throw new Error("Extra breakfast guests cannot be negative");
  if (input.booking_probability < 0 || input.booking_probability > 100)
    throw new Error("Booking probability must be 0–100");
}

export interface CalcOptions {
  totalOverride?: number | null;
  taxesIncluded?: boolean;
}

/**
 * Apply override + taxes-included semantics to a computed subtotal.
 * Mirrors the booking pricing engine in `src/lib/pricing.ts`.
 *   - taxesIncluded=true  → base treated as gross; back out tax
 *   - taxesIncluded=false → tax added on top of base
 *   - totalOverride       → replaces the base (still subject to taxesIncluded)
 */
export function finalizeTotals(rawSubtotal: number, options: CalcOptions = {}) {
  const ov = options.totalOverride;
  const hasOverride = ov !== null && ov !== undefined && Number.isFinite(Number(ov));
  const taxesIncluded = !!options.taxesIncluded;
  const base = hasOverride ? Math.max(0, Number(ov)) : Math.max(0, rawSubtotal);
  let subtotal: number; let taxes: number; let total: number;
  if (taxesIncluded) {
    subtotal = Math.round(base / (1 + TAX_RATE));
    taxes = Math.max(0, base - subtotal);
    total = base;
  } else {
    subtotal = base;
    taxes = Math.round(base * TAX_RATE);
    total = base + taxes;
  }
  return { subtotal, taxes, total, overrideApplied: hasOverride, taxesIncluded };
}

export function calc(input: QuoteInput, rateOverride?: number, options: CalcOptions = {}) {
  const nights = Math.max(
    1,
    Math.round(
      (new Date(input.check_out).getTime() - new Date(input.check_in).getTime()) / 86400000,
    ),
  );
  const room_rate = rateOverride && rateOverride > 0
    ? rateOverride
    : getRoomRate(input.room_type, input.breakfast_included);
  const roomTariff = room_rate * nights * input.rooms;

  let earlyCheck = 0;
  if (input.early_check_in && input.early_check_in_slot) {
    const slot = EARLY_CHECK_IN_SLOTS.find((s) => s.value === input.early_check_in_slot);
    earlyCheck = slot?.fee ?? room_rate * input.rooms;
  }
  let lateCheck = 0;
  if (input.late_check_out && input.late_check_out_slot) {
    const slot = LATE_CHECK_OUT_SLOTS.find((s) => s.value === input.late_check_out_slot);
    lateCheck = slot?.fee ?? room_rate * input.rooms;
  }

  const pet = (PET_RATES[input.pet_size] ?? 0) * nights;
  const extraAdults = input.extra_adults * EXTRA_ADULT_RATE * nights;
  const driversCharge = input.drivers * DRIVER_RATE * nights;
  const extraBreakfast =
    !input.breakfast_included && input.extra_breakfast_guests > 0
      ? input.extra_breakfast_guests * EXTRA_BREAKFAST_RATE * nights
      : 0;

  const rawSubtotal =
    roomTariff + earlyCheck + lateCheck + pet + extraAdults + driversCharge + extraBreakfast
    - (input.discount || 0);

  // Pull options off the input when caller hasn't provided them explicitly.
  const opt: CalcOptions = {
    totalOverride: options.totalOverride !== undefined ? options.totalOverride : (input.total_override ?? null),
    taxesIncluded: options.taxesIncluded !== undefined ? options.taxesIncluded : !!input.taxes_included,
  };
  const { subtotal, taxes, total, overrideApplied, taxesIncluded } = finalizeTotals(rawSubtotal, opt);

  return {
    nights, room_rate, roomTariff,
    extraBed: 0,
    earlyCheck, lateCheck, pet, extraAdults, driversCharge, extraBreakfast,
    subtotal, taxes, total,
    overrideApplied, taxesIncluded,
  };
}

function genReference() {
  const d = new Date();
  const s = `${d.getFullYear().toString().slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const r = Math.floor(Math.random() * 900 + 100);
  return `HEX-${s}-${r}`;
}

function normalize(input: QuoteInput): QuoteInput {
  return {
    ...input,
    early_check_in_slot: input.early_check_in ? input.early_check_in_slot ?? null : null,
    late_check_out_slot: input.late_check_out ? input.late_check_out_slot ?? null : null,
    extra_breakfast_guests: input.breakfast_included ? 0 : input.extra_breakfast_guests,
    pet_charges: input.pet_size !== "none",
    extra_bed: input.extra_adults, // mirror for legacy column
  };
}

export async function listQuotes() {
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as QuoteRow[];
}

export async function getQuote(id: string) {
  const { data, error } = await supabase.from("quotes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as unknown as QuoteRow | null;
}

async function logActivity(quote_id: string, type: string, description: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("quote_activities")
    .insert({ quote_id, user_id: user.id, type: type as any, description });
}

export async function createQuote(
  input: QuoteInput,
  initialStatus: QuoteStatus = "Pending",
  extraLineItems: import("./quote-items-api").QuoteItemInput[] = [],
  rateOverride?: number,
) {
  validateQuoteInput(input);
  const data = normalize(input);
  const c = calc(data, rateOverride);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  // Add extra line item subtotals into the quote total (line 0 is the primary form).
  const { computeItemSubtotal } = await import("./quote-items-api");
  const extraSubtotal = extraLineItems.reduce((s, it) => s + computeItemSubtotal(it), 0);
  // Raw subtotal = stay subtotal (from primary) + extras, BEFORE applying override/taxes-included.
  // c.subtotal already had override/taxes-included logic applied; re-derive raw from the inputs.
  // To keep the math correct with extras + override, we recompute final totals here using
  // the raw stay subtotal (room + extras) — i.e. invert the override applied to c if needed.
  const rawStaySubtotal = (c.roomTariff + c.earlyCheck + c.lateCheck + c.pet + c.extraAdults + c.driversCharge + c.extraBreakfast) - (data.discount || 0);
  const rawTotalBase = rawStaySubtotal + extraSubtotal;
  const { subtotal, taxes, total } = finalizeTotals(rawTotalBase, {
    totalOverride: data.total_override ?? null,
    taxesIncluded: !!data.taxes_included,
  });

  const row = {
    ...data,
    email: data.email || null,
    special_requests: data.special_requests || null,
    internal_notes: data.internal_notes || null,
    lost_reason: data.lost_reason || null,
    user_id: user.id,
    reference_code: genReference(),
    nights: c.nights,
    room_rate: c.room_rate,
    subtotal,
    taxes,
    total,
    total_override: data.total_override ?? null,
    taxes_included: !!data.taxes_included,
    status: initialStatus,
  };
  const { data: created, error } = await supabase
    .from("quotes")
    .insert(row as any)
    .select()
    .single();
  if (error) throw error;

  // Persist line items: line 0 = primary form, plus any extras.
  const { addQuoteItems } = await import("./quote-items-api");
  const primary: import("./quote-items-api").QuoteItemInput = {
    room_type: data.room_type,
    rooms: data.rooms,
    adults: data.adults,
    children: data.children,
    check_in: data.check_in,
    check_out: data.check_out,
    breakfast_included: data.breakfast_included,
    extra_bed: data.extra_bed,
    rate: c.room_rate,
    early_check_in: data.early_check_in,
    early_check_in_slot: data.early_check_in_slot ?? null,
    late_check_out: data.late_check_out,
    late_check_out_slot: data.late_check_out_slot ?? null,
    pet_size: data.pet_size,
    extra_adults: data.extra_adults,
    drivers: data.drivers,
  };
  await addQuoteItems(created.id, [primary, ...extraLineItems]);

  await logActivity(created.id, "created", `Quote ${created.reference_code} created${initialStatus === "Draft" ? " (draft)" : ""}`);
  return created as unknown as QuoteRow;
}

export async function updateQuote(
  id: string,
  input: QuoteInput,
  rateOverride?: number,
  extraLineItems: import("./quote-items-api").QuoteItemInput[] = [],
) {
  validateQuoteInput(input);
  const data = normalize(input);
  const c = calc(data, rateOverride);
  const { computeItemSubtotal } = await import("./quote-items-api");
  const extraSubtotal = extraLineItems.reduce((s, it) => s + computeItemSubtotal(it), 0);
  const rawStaySubtotal = (c.roomTariff + c.earlyCheck + c.lateCheck + c.pet + c.extraAdults + c.driversCharge + c.extraBreakfast) - (data.discount || 0);
  const { subtotal, taxes, total } = finalizeTotals(rawStaySubtotal + extraSubtotal, {
    totalOverride: data.total_override ?? null,
    taxesIncluded: !!data.taxes_included,
  });
  const { data: updated, error } = await supabase
    .from("quotes")
    .update({
      ...data,
      email: data.email || null,
      special_requests: data.special_requests || null,
      internal_notes: data.internal_notes || null,
      lost_reason: data.lost_reason || null,
      nights: c.nights,
      room_rate: c.room_rate,
      subtotal,
      taxes,
      total,
      total_override: data.total_override ?? null,
      taxes_included: !!data.taxes_included,
    } as any)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  await logActivity(id, "edited", "Quote updated");
  return updated as unknown as QuoteRow;
}

export async function setStatus(id: string, status: QuoteStatus, lostReason?: string) {
  const patch: any = { status };
  if ((status === "Lost" || status === "Cancelled") && lostReason) patch.lost_reason = lostReason;
  const { error } = await supabase.from("quotes").update(patch).eq("id", id);
  if (error) throw error;
  const booked = ["Confirmed", "Completed", "Converted"].includes(status);
  await logActivity(
    id,
    booked ? "converted" : "status_changed",
    `Status changed to ${status}${lostReason ? ` (${lostReason})` : ""}`,
  );
}

export async function setPaymentStatus(id: string, payment_status: PaymentStatus) {
  const { error } = await supabase.from("quotes").update({ payment_status } as any).eq("id", id);
  if (error) throw error;
  await logActivity(id, "status_changed", `Payment status: ${payment_status}`);
}

export async function deleteQuote(id: string) {
  const { error } = await supabase.from("quotes").delete().eq("id", id);
  if (error) throw error;
}

export async function duplicateQuote(id: string) {
  const src = await getQuote(id);
  if (!src) throw new Error("Quote not found");
  const {
    id: _id, reference_code: _r, user_id: _u, customer_id: _ci, created_at: _c,
    updated_at: _up, status: _s, nights: _n, room_rate: _rr, subtotal: _sub,
    taxes: _t, total: _tot, ...input
  } = src;
  return createQuote(input as QuoteInput);
}

export async function logWhatsApp(id: string, kind: string = "Quote") {
  await logActivity(id, "whatsapp_sent", `WhatsApp sent — ${kind}`);
}
export async function logPdf(id: string) {
  await logActivity(id, "pdf_generated", "PDF generated");
}

export async function listActivities(quote_id: string) {
  const { data, error } = await supabase
    .from("quote_activities").select("*").eq("quote_id", quote_id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addFollowup(quote_id: string, due_at: string, note: string | null) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("followups")
    .insert({ quote_id, user_id: user.id, due_at, note })
    .select().single();
  if (error) throw error;
  await logActivity(quote_id, "followup_added", `Follow-up set for ${new Date(due_at).toLocaleString()}`);
  return data;
}
export async function listFollowups() {
  const { data, error } = await supabase
    .from("followups").select("*, quotes(*)").order("due_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
export async function completeFollowup(id: string, quote_id: string) {
  const { error } = await supabase
    .from("followups").update({ completed: true, completed_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  await logActivity(quote_id, "followup_completed", "Follow-up marked complete");
}
export async function deleteFollowup(id: string) {
  const { error } = await supabase.from("followups").delete().eq("id", id);
  if (error) throw error;
}

/** Map user_id -> display name (or email) for "Created By" labels. */
export async function getUserNamesByIds(ids: string[]): Promise<Record<string, string>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (uniq.length === 0) return {};
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, email")
    .in("id", uniq);
  if (error) return {};
  const map: Record<string, string> = {};
  for (const p of data ?? []) {
    map[(p as any).id] = (p as any).display_name || (p as any).email || "";
  }
  return map;
}

/** WhatsApp deep-link with branded operational message (Hotel Excella format). */
export function buildWhatsAppLink(q: QuoteRow, items?: any[]) {
  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const c = calc(q);
  const inr = (n: number) => `₹${Math.round(Number(n)).toLocaleString("en-IN")}`;
  const guestLine = [
    `${q.adults || 0} Adult${(q.adults || 0) === 1 ? "" : "s"}`,
    (q.children || 0) > 0 ? `${q.children} Child${q.children === 1 ? "" : "ren"}` : "",
  ].filter(Boolean).join(" + ");

  const tariff: string[] = [];
  tariff.push(`• Room Charges: ${inr(c.roomTariff)}`);
  if (q.extra_adults > 0) tariff.push(`• Extra Adult × ${q.extra_adults}: ${inr(c.extraAdults)}`);
  if (q.drivers > 0) tariff.push(`• Driver × ${q.drivers}: ${inr(c.driversCharge)}`);
  if (!q.breakfast_included && q.extra_breakfast_guests > 0)
    tariff.push(`• Extra Breakfast × ${q.extra_breakfast_guests}: ${inr(c.extraBreakfast)}`);
  if (q.pet_size && q.pet_size !== "none") tariff.push(`• Pet (${q.pet_size}): ${inr(c.pet)}`);
  if (q.early_check_in && q.early_check_in_slot)
    tariff.push(`• Early Check-in (${earlyCheckInLabel(q.early_check_in_slot)}): ${inr(c.earlyCheck)}`);
  if (q.late_check_out && q.late_check_out_slot)
    tariff.push(`• Late Check-out (${lateCheckOutLabel(q.late_check_out_slot)}): ${inr(c.lateCheck)}`);
  if (Number(q.discount) > 0) tariff.push(`• Discount: -${inr(Number(q.discount))}`);
  tariff.push(`• Taxes (5%): ${inr(c.taxes)}`);

  // Build room-by-room block when multi-line items are available.
  const roomBlock: string[] = [];
  const multi = items && items.length > 1;
  if (multi) {
    items!.forEach((it: any, i: number) => {
      const occ = `${it.adults || 0} Adult${(it.adults || 0) === 1 ? "" : "s"}${(it.children || 0) > 0 ? ` + ${it.children} Child${it.children === 1 ? "" : "ren"}` : ""}${it.extra_bed ? ` + ${it.extra_bed} Extra Bed` : ""}`;
      roomBlock.push(`Room ${i + 1}`);
      roomBlock.push(`• Room Type: ${it.room_type}`);
      roomBlock.push(`• Guests: ${occ}`);
      roomBlock.push(`• Check-in: ${fmtDate(it.check_in)} | 1:00 PM`);
      roomBlock.push(`• Check-out: ${fmtDate(it.check_out)} | 11:00 AM`);
      roomBlock.push(`• Nights: ${it.nights}`);
      if (it.breakfast_included) roomBlock.push(`• Breakfast: Included`);
      roomBlock.push(`• Subtotal: ${inr(Number(it.subtotal))}`);
      roomBlock.push(``);
    });
  }

  const stayBlock = multi ? roomBlock : [
    `🏨 Room Details`,
    `• Room Type: ${q.room_type} × ${q.rooms}`,
    `• Check-in: ${fmtDate(q.check_in)} | 1:00 PM`,
    `• Check-out: ${fmtDate(q.check_out)} | 11:00 AM`,
    `• Duration: ${q.nights} Night${q.nights > 1 ? "s" : ""}`,
    `• Guests: ${guestLine}`,
    ...(q.breakfast_included ? [`• Breakfast: Included`] : []),
    ``,
  ];

  const lines = [
    `Greetings from Hotel Excella ✨`,
    `Dear ${q.guest_name},`,
    `Thank you for considering Hotel Excella for your stay. Please find your quotation details below:`,
    `📌 Quotation Ref: ${q.reference_code}`,
    ``,
    ...(multi ? [`🏨 Stay Details (${items!.length} Rooms / Segments)`, ``] : []),
    ...stayBlock,
    `💰 Tariff Breakdown`,
    ...tariff,
    `✅ Total Amount Payable: ${inr(q.total)}`,
    `(Inclusive of all applicable taxes)`,
    ``,
    `🌟 Why Stay with Hotel Excella?`,
    `✔ Free High-Speed Wi-Fi`,
    `✔ Walkable Distance to Beach`,
    `✔ Close to Major Sightseeing Attractions`,
    `✔ Comfortable AC Rooms`,
    `✔ Smart TV Entertainment`,
    `✔ 24/7 Reception Assistance`,
    `✔ Daily Housekeeping Service`,
    ``,
    `📍 Convenient location with easy access to the city, beaches, and tourist spots.`,
    `⏳ This quotation is valid for 7 days.`,
    ``,
    `We would be delighted to host you and make your stay comfortable and memorable.`,
    ``,
    `Warm Regards,`,
    `Hotel Excella Reservations Team`,
  ];

  const text = encodeURIComponent(lines.join("\n"));
  const phone = phoneToWaDigits(q.phone);
  return `https://wa.me/${phone}?text=${text}`;
}

