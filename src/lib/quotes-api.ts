import { supabase } from "@/integrations/supabase/client";
import { roomTypes, type QuoteStatus } from "@/lib/mock-data";

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
  early_check_in: boolean;
  late_check_out: boolean;
  pet_charges: boolean;
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

export function calc(input: QuoteInput) {
  const nights = Math.max(
    1,
    Math.round(
      (new Date(input.check_out).getTime() - new Date(input.check_in).getTime()) / 86400000,
    ),
  );
  const room = roomTypes.find((r) => r.name === input.room_type) ?? roomTypes[0];
  const room_rate = room.rate;
  const roomTariff = room_rate * nights * input.rooms;
  const extraBed = input.extra_bed * 500 * nights;
  const earlyCheck = input.early_check_in ? 500 : 0;
  const lateCheck = input.late_check_out ? 500 : 0;
  const pet = input.pet_charges ? 1000 : 0;
  const subtotal = roomTariff + extraBed + earlyCheck + lateCheck + pet - (input.discount || 0);
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
  const c = calc(input);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const row = {
    ...input,
    email: input.email || null,
    special_requests: input.special_requests || null,
    internal_notes: input.internal_notes || null,
    user_id: user.id,
    reference_code: genReference(),
    nights: c.nights,
    room_rate: c.room_rate,
    subtotal: c.subtotal,
    taxes: c.taxes,
    total: c.total,
    status: "Pending" as QuoteStatus,
  };
  const { data, error } = await supabase.from("quotes").insert(row).select().single();
  if (error) throw error;
  await logActivity(data.id, "created", `Quote ${data.reference_code} created`);
  return data as QuoteRow;
}

export async function updateQuote(id: string, input: QuoteInput) {
  const c = calc(input);
  const { data, error } = await supabase
    .from("quotes")
    .update({
      ...input,
      email: input.email || null,
      special_requests: input.special_requests || null,
      internal_notes: input.internal_notes || null,
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
  return data as QuoteRow;
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
    `• Check-in: ${new Date(q.check_in).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
    `• Check-out: ${new Date(q.check_out).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
    `• Nights: ${q.nights}`,
    `• Room: ${q.room_type} × ${q.rooms}`,
    `• Guests: ${q.group_size}`,
    ``,
    `*Total: ₹${Number(q.total).toLocaleString("en-IN")}* (incl. taxes)`,
    ``,
    `We would be delighted to host you.`,
    `— Hotel Excella Reservations`,
  ];
  const text = encodeURIComponent(lines.join("\n"));
  const phone = q.phone.replace(/[^0-9]/g, "");
  return `https://wa.me/${phone}?text=${text}`;
}
