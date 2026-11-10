/**
 * Copilot front-desk lookups (read-only). Reuses canonical engines:
 * vacancy → getRoomTypeAvailability, balance → validateCheckout, search → findCopilotMatches.
 */
import { supabase } from "@/integrations/supabase/client";
import { getRoomTypeAvailability } from "@/lib/room-inventory";
import { validateCheckout } from "@/lib/checkout-validation";
import { findCopilotMatches, bookingLabel } from "@/lib/copilot-update";
import { toLocalYMD } from "@/lib/utils";

export type CopilotQuery = { kind: "vacancy" | "occupant" | "balance"; room_type: string | null; room: string | null; target: string | null; date: string | null };
export type CopilotQueryAnswer = { text: string; bookingId?: string; label?: string };

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const nextDay = (d: string) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + 1); return toLocalYMD(x); };

export async function answerCopilotQuery(q: CopilotQuery): Promise<CopilotQueryAnswer> {
  if (q.kind === "vacancy") {
    const d = q.date ?? toLocalYMD();
    const a = await getRoomTypeAvailability({ check_in: d, check_out: nextDay(d) });
    const rows = Object.values(a.byType).filter((r) => !q.room_type || r.room_type.toLowerCase().includes(q.room_type.toLowerCase().split(" ")[0]));
    if (!rows.length) return { text: `No rooms found${q.room_type ? ` for ${q.room_type}` : ""}.` };
    return { text: `Vacant on ${d}: ` + rows.map((r) => `${r.room_type} ${r.available} of ${r.total}`).join(", ") + "." };
  }
  if (q.kind === "occupant") {
    if (!q.room) return { text: "Which room number?" };
    const { data: room } = await supabase.from("rooms").select("id, room_number").eq("room_number", q.room).maybeSingle();
    if (!room) return { text: `Room ${q.room} not found.` };
    const { data: items } = await supabase.from("booking_items").select("booking_id").eq("assigned_room_id", (room as any).id).eq("item_status", "Checked-In").limit(1);
    const bid = (items as any[] | null)?.[0]?.booking_id;
    if (!bid) return { text: `Room ${q.room} is not occupied right now.` };
    const { data: b } = await supabase.from("bookings").select("id, guest_name, phone, booking_reference, check_in, check_out").eq("id", bid).maybeSingle();
    if (!b) return { text: `Room ${q.room} is occupied.` };
    const bb: any = b;
    return { text: `Room ${q.room}: ${bb.guest_name}${bb.phone ? ` (+91 ${bb.phone})` : ""}, ${String(bb.check_in).slice(0, 10)} → ${String(bb.check_out).slice(0, 10)}.`, bookingId: bb.id, label: bookingLabel(bb) };
  }
  if (!q.target) return { text: "Whose balance? Tell me the guest name, room or mobile." };
  const m = await findCopilotMatches(q.target);
  if (!m.length) return { text: `I couldn't find an open booking for "${q.target}".` };
  const b = m[0];
  const v = await validateCheckout(b.id);
  const more = m.length > 1 ? ` (${m.length - 1} other match${m.length > 2 ? "es" : ""})` : "";
  return { text: `${b.guest_name}: balance due ${inr(Math.max(0, v.balance))}${more}.`, bookingId: b.id, label: bookingLabel(b as any) };
}
