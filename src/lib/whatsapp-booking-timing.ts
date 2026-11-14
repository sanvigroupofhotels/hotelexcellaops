import { describeEarlySlot, describeLateSlot } from "@/lib/expected-times";
import type { EarlyCheckInSlot, LateCheckOutSlot } from "@/lib/mock-data";
import { expandLineToRooms } from "@/lib/guest-allocation";
import { lineSubtotal, type LineItem } from "@/components/line-items-editor";

export function bookingTimingFields(early?: EarlyCheckInSlot | null, late?: LateCheckOutSlot | null) {
  return {
    early_check_in: !!early, early_check_in_slot: early ?? null,
    late_check_out: !!late, late_check_out_slot: late ?? null,
  };
}

export function bookingTimingLabels(early?: EarlyCheckInSlot | null, late?: LateCheckOutSlot | null) {
  return {
    checkIn: early ? describeEarlySlot(early).label.replace(/\s*\(.*\)/, "") : "Standard (1:00 PM onwards)",
    checkOut: late ? describeLateSlot(late).label.replace(/\s*\(.*\)/, "") : "Standard (by 11:00 AM)",
  };
}

/** Slot selections are pricing windows, not fabricated exact arrival timestamps. */
export function buildEngineRoomLines(input: {
  room_type: string; rooms: number; guests: number; check_in: string; check_out: string;
  rate: number; early?: EarlyCheckInSlot | null; late?: LateCheckOutSlot | null;
}) {
  const line: LineItem = {
    room_type: input.room_type, rooms: input.rooms, adults: input.guests, children: 0,
    check_in: input.check_in, check_out: input.check_out, rate: input.rate,
    breakfast_included: false, extra_bed: 0, pet_size: "none", extra_adults: 0, drivers: 0,
    ...bookingTimingFields(input.early, input.late),
  };
  return expandLineToRooms(line).map((item, position) => ({ ...item, position, subtotal: lineSubtotal(item) }));
}