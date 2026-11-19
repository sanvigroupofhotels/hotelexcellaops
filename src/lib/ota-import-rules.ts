import { z } from "zod";
import { applyTaxes } from "@/lib/pricing";
import { expandLineToRooms } from "@/lib/guest-allocation";

export const OTA_ROOM_LABELS = ["Number of Rooms", "Rooms", "No of Rooms", "Total Rooms", "Room Count"];
export const OTA_PAYMENT_LABELS = ["Payment Mode", "Payment Type", "Mode of Payment", "Payment Method"];
export const DEFAULT_OTA_CATEGORY_MAP: Record<string, string> = {
  "Deluxe Room": "Oak Room", Standard: "Oak Room", Classic: "Oak Room",
  "Executive Room": "Mapple Room", Suite: "Mapple Room", "King Room": "Mapple Room", Premium: "Mapple Room",
};
export const otaCategoryMapSchema = z.record(z.string().trim().min(1).max(120), z.string().trim().min(1).max(120));

export function resolveOtaRooms(details: string, explicit: string | number | null, mappings: Record<string, string> = DEFAULT_OTA_CATEGORY_MAP) {
  const prefix = details.trim().match(/^(\d+)\s*(?:[x×]\s*)?(.+)$/i);
  const raw = explicit == null || explicit === "" ? (prefix?.[1] ?? "1") : String(explicit);
  const count = Number(raw.match(/^\s*(\d+)\b/)?.[1]);
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("Number of rooms must be between 1 and 20");
  const name = (prefix?.[2] ?? details).trim();
  const normalized = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const key = Object.keys(mappings).find((label) => normalized(label) === normalized(name));
  return { rooms: count, room_type: key ? mappings[key] : name || "Imported Room" };
}

export function otaPaymentAmount(mode: string | null, total: number) {
  // Part Pay emails do not reliably state the split. Never guess a credit.
  return /^pre[\s-]?paid$/i.test((mode ?? "").trim()) ? Math.max(0, total) : 0;
}

export function buildOtaImport(input: {
  room_details: string; rooms?: string | number | null; guests: number;
  check_in: string; check_out: string; total_amount: number; payment_mode: string | null;
}, taxRate: number, mappings?: Record<string, string>) {
  if (!Number.isFinite(input.total_amount) || input.total_amount <= 0) throw new Error("Missing or invalid total booking amount");
  const nights = (Date.parse(input.check_out) - Date.parse(input.check_in)) / 86400000;
  if (!Number.isInteger(nights) || nights < 1 || nights > 365) throw new Error("Invalid OTA stay dates");
  const room = resolveOtaRooms(input.room_details, input.rooms ?? null, mappings);
  const pricing = applyTaxes(input.total_amount, taxRate, true);
  const rate = pricing.subtotal / (nights * room.rooms);
  const items = expandLineToRooms({
    ...room, adults: Math.max(1, input.guests), children: 0, check_in: input.check_in, check_out: input.check_out,
    breakfast_included: false, extra_bed: 0, rate, early_check_in: false, early_check_in_slot: null,
    late_check_out: false, late_check_out_slot: null, pet_size: "none", extra_adults: 0, drivers: 0,
    notes: "OTA imported room",
  }).map((item, position) => ({ ...item, position, subtotal: rate * nights }));
  return { pricing, room, items, advance: otaPaymentAmount(input.payment_mode, pricing.total) };
}