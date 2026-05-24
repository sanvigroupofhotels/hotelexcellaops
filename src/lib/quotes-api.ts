import { supabase } from "@/integrations/supabase/client";
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

export const TAX_RATE = 0.12;

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
  if (!/^[+0-9 ()-]{7,}$/.test(input.phone.trim()))
    throw new Error("Phone number looks invalid");
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

export function calc(input: QuoteInput) {
  const nights = Math.max(
    1,
    Math.round(
      (new Date(input.check_out).getTime() - new Date(input.check_in).getTime()) / 86400000,
    ),
  );
  const room_rate = getRoomRate(input.room_type, input.breakfast_included);
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

  const subtotal =
    roomTariff + earlyCheck + lateCheck + pet + extraAdults + driversCharge + extraBreakfast
    - (input.discount || 0);
  const taxes = Math.round(subtotal * TAX_RATE);
  const total = subtotal + taxes;
  return {
    nights, room_rate, roomTariff,
    extraBed: 0, // deprecated bucket
    earlyCheck, lateCheck, pet, extraAdults, driversCharge, extraBreakfast,
    subtotal, taxes, total,
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

export async function createQuote(input: QuoteInput) {
  validateQuoteInput(input);
  const data = normalize(input);
  const c = calc(data);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

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
    subtotal: c.subtotal,
    taxes: c.taxes,
    total: c.total,
    status: "Pending" as QuoteStatus,
  };
  const { data: created, error } = await supabase
    .from("quotes")
    .insert(row as any)
    .select()
    .single();
  if (error) throw error;
  await logActivity(created.id, "created", `Quote ${created.reference_code} created`);
  return created as unknown as QuoteRow;
}

export async function updateQuote(id: string, input: QuoteInput) {
  validateQuoteInput(input);
  const data = normalize(input);
  const c = calc(data);
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
      subtotal: c.subtotal,
      taxes: c.taxes,
      total: c.total,
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

/** WhatsApp deep-link with branded operational message. */
export function buildWhatsAppLink(q: QuoteRow) {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const c = calc(q);
  const inr = (n: number) => `₹${Math.round(Number(n)).toLocaleString("en-IN")}`;
  const guestLine = [
    `${q.adults || 0} Adult${(q.adults || 0) === 1 ? "" : "s"}`,
    (q.children || 0) > 0 ? `${q.children} Child${q.children === 1 ? "" : "ren"}` : "",
  ].filter(Boolean).join(" · ");

  const breakdown: string[] = [];
  breakdown.push(`Room Charges: ${inr(c.roomTariff)}`);
  if (q.extra_adults > 0) breakdown.push(`Extra Adult × ${q.extra_adults}: ${inr(c.extraAdults)}`);
  if (q.drivers > 0) breakdown.push(`Driver × ${q.drivers}: ${inr(c.driversCharge)}`);
  if (!q.breakfast_included && q.extra_breakfast_guests > 0)
    breakdown.push(`Extra Breakfast × ${q.extra_breakfast_guests}: ${inr(c.extraBreakfast)}`);
  if (q.pet_size && q.pet_size !== "none") breakdown.push(`Pet (${q.pet_size}): ${inr(c.pet)}`);
  if (q.early_check_in && q.early_check_in_slot)
    breakdown.push(`Early Check-in (${earlyCheckInLabel(q.early_check_in_slot)}): ${inr(c.earlyCheck)}`);
  if (q.late_check_out && q.late_check_out_slot)
    breakdown.push(`Late Check-out (${lateCheckOutLabel(q.late_check_out_slot)}): ${inr(c.lateCheck)}`);
  if (Number(q.discount) > 0) breakdown.push(`Discount: -${inr(Number(q.discount))}`);
  breakdown.push(`Taxes (12%): ${inr(c.taxes)}`);

  const lines = [
    `Greetings from *Hotel Excella* ✨`,
    ``,
    `Dear ${q.guest_name}, please find your stay quotation below:`,
    ``,
    `📌 *Ref:* ${q.reference_code}`,
    `📍 *Room:* ${q.room_type} × ${q.rooms}`,
    `📅 *Check-in:* ${fmt(q.check_in)} (1:00 PM)`,
    `📅 *Check-out:* ${fmt(q.check_out)} (11:00 AM)`,
    `🌙 *Nights:* ${q.nights}`,
    `👥 *Guests:* ${guestLine}`,
    `🍳 *Breakfast:* ${q.breakfast_included ? "Included" : "Not included"}`,
    ``,
    `💰 *Tariff Breakdown*`,
    ...breakdown.map((b) => `• ${b}`),
    ``,
    `✅ *Total Amount: ${inr(q.total)}* (incl. all taxes)`,
    ``,
    `*Amenities*`,
    `✔ Free Wi-Fi`,
    `✔ AC Rooms`,
    `✔ Smart TV`,
    `✔ 24/7 Reception`,
    `✔ Daily Housekeeping`,
    ``,
    `Quote valid for 7 days. We would be delighted to host you.`,
    ``,
    `Thank you,`,
    `*Hotel Excella Reservations*`,
  ];
  const text = encodeURIComponent(lines.join("\n"));
  const phone = q.phone.replace(/[^0-9]/g, "");
  return `https://wa.me/${phone}?text=${text}`;
}
