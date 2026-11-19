import { z } from "zod";
import { allocateGuestsToLines, expandLineToRooms, getOccupancyConfig } from "@/lib/guest-allocation";
import { bookingTimingFields } from "@/lib/whatsapp-booking-timing";
import { lineSubtotal, type LineItem } from "@/components/line-items-editor";
import { computePricing } from "@/lib/pricing";
import type { EarlyCheckInSlot, LateCheckOutSlot } from "@/lib/mock-data";

export const roomSelectionsSchema = z.array(z.object({
  room_type: z.string().trim().min(1).max(80), rooms: z.number().int().min(0).max(20),
})).min(1).max(10).refine((rows) => rows.reduce((sum, row) => sum + row.rooms, 0) >= 1, "Select at least one room.")
  .refine((rows) => rows.reduce((sum, row) => sum + row.rooms, 0) <= 20, "Select no more than 20 rooms.")
  .refine((rows) => new Set(rows.map((row) => row.room_type.toLowerCase().replace(/\s+room$/i, ""))).size === rows.length, "Select each category once.");

export type EngineCategory = { type: string; room_type_key: string; available: number; nights: number; subtotal: number; tax_rate: number; nightly: { date: string; rate: number }[] };

/** Shared estimate and persistence plan; category tariffs are supplied by the server. */
export function planWhatsAppRooms(input: {
  selections: z.infer<typeof roomSelectionsSchema>; categories: EngineCategory[];
  adults: number; children: number; check_in: string; check_out: string;
  early?: EarlyCheckInSlot | null; late?: LateCheckOutSlot | null;
}) {
  const selections = roomSelectionsSchema.parse(input.selections).filter((row) => row.rooms > 0);
  const lines: LineItem[] = selections.map((selection) => {
    const category = input.categories.find((row) => row.room_type_key === selection.room_type);
    if (!category || selection.rooms > category.available) throw new Error(`Not enough ${selection.room_type} rooms available. Please refresh your selection.`);
    if (!(category.subtotal > 0)) throw new Error("Room pricing is unavailable. Please contact reception.");
    return {
      room_type: selection.room_type, rooms: selection.rooms, adults: 0, children: 0,
      check_in: input.check_in, check_out: input.check_out, rate: category.subtotal / category.nights,
      breakfast_included: false, extra_bed: 0, pet_size: "none", extra_adults: 0, drivers: 0,
      ...bookingTimingFields(input.early, input.late),
    };
  });
  const adultCapacity = lines.reduce((sum, row) => sum + getOccupancyConfig(row.room_type).maxAdults * row.rooms, 0);
  const childCapacity = lines.reduce((sum, row) => sum + getOccupancyConfig(row.room_type).maxChildren * row.rooms, 0);
  if (input.adults > adultCapacity || input.children > childCapacity) throw new Error("Please select more rooms for your guests.");
  const allocated = allocateGuestsToLines(lines, { adults: input.adults, children: input.children });
  const items = allocated.flatMap(expandLineToRooms).map((item, position) => ({ ...item, position, subtotal: lineSubtotal(item) }));
  // Published tariffs and extras are GST-inclusive: the gross sum is the guest total and GST is split out of it.
  const taxRate = input.categories[0]?.tax_rate ?? 0.05;
  const gross = computePricing(items, 0, taxRate).subtotal;
  const pricing = computePricing(items, 0, taxRate, { totalOverride: gross, taxesIncluded: true });
  return { items, pricing, rooms: items.length, summary: selections.map((row) => `${row.room_type} × ${row.rooms}`).join(", ") };
}