import { emptyLine, type LineItem } from "@/components/line-items-editor";
import { allocateGuestsToLines } from "@/lib/guest-allocation";
import { roomTypes, getRoomRate } from "@/lib/mock-data";

export const LEAD_STAGES = ["Price Quoted", "Followed Up", "Negotiating", "Call Back Later"] as const;

export function leadRoomLines(lead: {
  room_type_name: string | null; rooms: number | null; adults: number | null;
  children: number | null; check_in: string | null; check_out: string | null;
}): LineItem[] {
  const parts = (lead.room_type_name ?? "").split(/\s*[,;+]\s*/).filter(Boolean);
  const lines = (parts.length ? parts : [""]).map((part) => {
    const match = part.match(/^(.*?)\s*[×x]\s*(\d+)$/i);
    const line = emptyLine();
    if (match?.[1]) line.room_type = match[1].trim();
    else if (part) line.room_type = part.trim();
    const key = line.room_type.toLowerCase().replace(/\s*room$/, "").replace("maple", "mapple");
    const canonical = roomTypes.find((r) => r.name.toLowerCase().replace(/\s*room$/, "") === key);
    if (canonical) line.room_type = canonical.name;
    line.rate = getRoomRate(line.room_type, line.breakfast_included);
    line.rooms = Math.max(1, Number(match?.[2] ?? (parts.length <= 1 ? lead.rooms : 1)) || 1);
    if (lead.check_in) line.check_in = lead.check_in;
    if (lead.check_out) line.check_out = lead.check_out;
    return line;
  });
  return allocateGuestsToLines(lines, { adults: lead.adults ?? 2, children: lead.children ?? 0 });
}

export function directOfferAmount(value: string): number | null {
  const amount = Number(value);
  return value.trim() && Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}