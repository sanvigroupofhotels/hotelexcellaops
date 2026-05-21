import { supabase } from "@/integrations/supabase/client";
import {
  roomTypes,
  EARLY_CHECK_IN_SLOTS,
  LATE_CHECK_OUT_SLOTS,
  EXTRA_ADULT_RATE,
  DRIVER_RATE,
  EXTRA_BREAKFAST_RATE,
  earlyCheckInLabel,
  lateCheckOutLabel,
  type EarlyCheckInSlot,
  type LateCheckOutSlot,
  type QuoteStatus,
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
  extra_bed: number;
  // Policy fields
  early_check_in: boolean;
  early_check_in_slot?: EarlyCheckInSlot | null;
  late_check_out: boolean;
  late_check_out_slot?: LateCheckOutSlot | null;
  pet_charges: boolean;
  extra_adults: number;
  drivers: number;
  breakfast_included: boolean;
  extra_breakfast_guests: number;
  discount: number;
  internal_notes?: string | null;
}

export interface QuoteRow extends QuoteInput {
  id: string;
  reference_code: string;
  user_id: string;
  status: QuoteStatus;
  nights: number;
  room_rate: number;
  subtotal: number;
  taxes: number;
  total: number;
  created_at: string;
  updated_at: string;
}

/** Validate inputs and throw a human-readable error if invalid. */
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
  if (input.extra_bed < 0) throw new Error("Extra bed cannot be negative");
  if (input.extra_adults < 0) throw new Error("Extra adults cannot be negative");
  if (input.drivers < 0) throw new Error("Drivers cannot be negative");
  if (input.discount < 0) throw new Error("Discount cannot be negative");

  if (input.early_check_in && !input.early_check_in_slot)
    throw new Error("Select an early check-in time slot");
  if (input.late_check_out && !input.late_check_out_slot)
    throw new Error("Select a late check-out time slot");

  if (input.breakfast_included && input.extra_breakfast_guests > 0)
    throw new Error(
      "Extra breakfast guests only apply when breakfast is not included",
    );
  if (!input.breakfast_included && input.extra_breakfast_guests < 0)
    throw new Error("Extra breakfast guests cannot be negative");
}

export function calc(input: QuoteInput) {
  const nights = Math.max(
    1,
    Math.round(
      (new Date(input.check_out).getTime() - new Date(input.check_in).getTime()) /
        86400000,
    ),
  );
  const room = roomTypes.find((r) => r.name === input.room_type) ?? roomTypes[0];
  const room_rate = room.rate;
  const roomTariff = room_rate * nights * input.rooms;
  const extraBed = input.extra_bed * 500 * nights;

  // Early check-in fee
  let earlyCheck = 0;
  if (input.early_check_in && input.early_check_in_slot) {
    const slot = EARLY_CHECK_IN_SLOTS.find(
      (s) => s.value === input.early_check_in_slot,
    );
    earlyCheck = slot?.fee ?? room_rate * input.rooms; // null = full day room charge
  }

  // Late check-out fee
  let lateCheck = 0;
  if (input.late_check_out && input.late_check_out_slot) {
    const slot = LATE_CHECK_OUT_SLOTS.find(
      (s) => s.value === input.late_check_out_slot,
    );
    lateCheck = slot?.fee ?? room_rate * input.rooms;
  }

  const pet = input.pet_charges ? 1000 : 0;
  const extraAdults = input.extra_adults * EXTRA_ADULT_RATE * nights;
  const driversCharge = input.drivers * DRIVER_RATE * nights;
  const extraBreakfast =
    !input.breakfast_included && input.extra_breakfast_guests > 0
      ? input.extra_breakfast_guests * EXTRA_BREAKFAST_RATE * nights
      : 0;

  const subtotal =
    roomTariff +
    extraBed +
    earlyCheck +
    lateCheck +
    pet +
    extraAdults +
    driversCharge +
    extraBreakfast -
    (input.discount || 0);
  const taxes = Math.round(subtotal * TAX_RATE);
  const total = subtotal + taxes;
  return {
    nights,
    room_rate,
    roomTariff,
    extraBed,
    earlyCheck,
    lateCheck,
    pet,
    extraAdults,
    driversCharge,
    extraBreakfast,
    subtotal,
    taxes,
    total,
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
  };
}

export async function listQuotes() {
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as QuoteRow[];
}

export async function getQuote(id: string) {
  const { data, error } = await supabase.from("quotes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as QuoteRow | null;
}

async function logActivity(
  quote_id: string,
  type: string,
  description: string,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("quote_activities")
    .insert({ quote_id, user_id: user.id, type: type as any, description });
}

export async function createQuote(input: QuoteInput) {
  validateQuoteInput(input);
  const data = normalize(input);
  const c = calc(data);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const row = {
    ...data,
    email: data.email || null,
    special_requests: data.special_requests || null,
    internal_notes: data.internal_notes || null,
    user_id: user.id,
    reference_code: genReference(),
    nights: c.nights,
    room_rate: c.room_rate,
    subtotal: c.subtotal,
    taxes: c.taxes,
    total: c.total,
    status: "Pending" as QuoteStatus,
  };
  const { data: created, error } = await supabase.from("quotes").insert(row).select().single();
  if (error) throw error;
  await logActivity(created.id, "created", `Quote ${created.reference_code} created`);
  return created as QuoteRow;
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
      nights: c.nights,
      room_rate: c.room_rate,
      subtotal: c.subtotal,
      taxes: c.taxes,
      total: c.total,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  await logActivity(id, "edited", `Quote updated`);
  return updated as QuoteRow;
}

export async function setStatus(id: string, status: QuoteStatus) {
  const { error } = await supabase.from("quotes").update({ status }).eq("id", id);
  if (error) throw error;
  await logActivity(
    id,
    status === "Converted" ? "converted" : "status_changed",
    `Status changed to ${status}`,
  );
}

export async function deleteQuote(id: string) {
  const { error } = await supabase.from("quotes").delete().eq("id", id);
  if (error) throw error;
}

export async function duplicateQuote(id: string) {
  const src = await getQuote(id);
  if (!src) throw new Error("Quote not found");
  const {
    id: _id,
    reference_code: _r,
    user_id: _u,
    created_at: _c,
    updated_at: _up,
    status: _s,
    nights: _n,
    room_rate: _rr,
    subtotal: _sub,
    taxes: _t,
    total: _tot,
    ...input
  } = src;
  return createQuote(input as QuoteInput);
}

export async function logWhatsApp(id: string) {
  await logActivity(id, "whatsapp_sent", "WhatsApp message sent");
}
export async function logPdf(id: string) {
  await logActivity(id, "pdf_generated", "PDF generated");
}

export async function listActivities(quote_id: string) {
  const { data, error } = await supabase
    .from("quote_activities")
    .select("*")
    .eq("quote_id", quote_id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addFollowup(
  quote_id: string,
  due_at: string,
  note: string | null,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("followups")
    .insert({ quote_id, user_id: user.id, due_at, note })
    .select()
    .single();
  if (error) throw error;
  await logActivity(quote_id, "followup_added", `Follow-up set for ${new Date(due_at).toLocaleString()}`);
  return data;
}

export async function listFollowups() {
  const { data, error } = await supabase
    .from("followups")
    .select("*, quotes(*)")
    .order("due_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function completeFollowup(id: string, quote_id: string) {
  const { error } = await supabase
    .from("followups")
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  await logActivity(quote_id, "followup_completed", "Follow-up marked complete");
}

export async function deleteFollowup(id: string) {
  const { error } = await supabase.from("followups").delete().eq("id", id);
  if (error) throw error;
}

/** Build a WhatsApp deep-link with a polished, branded message. */
export function buildWhatsAppLink(q: QuoteRow) {
  const lines = [
    `*Hotel Excella — Quotation*`,
    `Ref: ${q.reference_code}`,
    ``,
    `Dear ${q.guest_name},`,
    `Thank you for considering Hotel Excella. Here are the details of your stay:`,
    ``,
    `• Check-in: ${new Date(q.check_in).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} (Standard 1:00 PM)`,
    `• Check-out: ${new Date(q.check_out).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} (Standard 11:00 AM)`,
    `• Nights: ${q.nights}`,
    `• Room: ${q.room_type} × ${q.rooms}`,
    `• Guests: ${q.group_size}`,
    q.extra_adults > 0 ? `• Extra Adults: ${q.extra_adults} (₹${EXTRA_ADULT_RATE}/night, incl. mattress & breakfast)` : "",
    q.drivers > 0 ? `• Drivers: ${q.drivers} (₹${DRIVER_RATE}/night, incl. mattress & breakfast)` : "",
    `• Breakfast: ${q.breakfast_included ? "Included" : "Not included"}`,
    !q.breakfast_included && q.extra_breakfast_guests > 0
      ? `• Extra Breakfast: ${q.extra_breakfast_guests} guest(s) @ ₹${EXTRA_BREAKFAST_RATE}/head/night`
      : "",
    q.early_check_in && q.early_check_in_slot
      ? `• Early Check-in: ${earlyCheckInLabel(q.early_check_in_slot)} (subject to availability)`
      : "",
    q.late_check_out && q.late_check_out_slot
      ? `• Late Check-out: ${lateCheckOutLabel(q.late_check_out_slot)} (subject to availability)`
      : "",
    ``,
    `*Total: ₹${Number(q.total).toLocaleString("en-IN")}* (incl. taxes)`,
    ``,
    `We would be delighted to host you.`,
    `— Hotel Excella Reservations`,
  ].filter(Boolean);
  const text = encodeURIComponent(lines.join("\n"));
  const phone = q.phone.replace(/[^0-9]/g, "");
  return `https://wa.me/${phone}?text=${text}`;
}
