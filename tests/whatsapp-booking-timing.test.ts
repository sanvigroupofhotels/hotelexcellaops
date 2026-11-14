import { describe, expect, it } from "vitest";
import { buildEngineRoomLines, bookingTimingFields } from "@/lib/whatsapp-booking-timing";
import { resolveEarlyCheckInWindow, resolveLateCheckOutWindow } from "@/lib/expected-times";

const stay = { room_type: "Oak Room", rooms: 1, guests: 2, check_in: "2026-11-15", check_out: "2026-11-16", rate: 3000 };
describe("WhatsApp booking timings", () => {
  it("charges the 8–10 AM arrival window ₹750 for a 9 AM arrival", () => {
    const early = resolveEarlyCheckInWindow("09:00")?.slot;
    expect(buildEngineRoomLines({ ...stay, early })[0].subtotal).toBe(3750);
  });
  it("charges the up-to-2 PM departure window ₹500 at 2 PM", () => {
    const late = resolveLateCheckOutWindow("14:00")?.slot;
    expect(buildEngineRoomLines({ ...stay, late })[0].subtotal).toBe(3500);
  });
  it("charges each selected room once and keeps slots on each room", () => {
    const lines = buildEngineRoomLines({ ...stay, rooms: 2, early: "8-10", late: "upto-2pm" });
    expect(lines).toHaveLength(2);
    expect(lines.reduce((sum, line) => sum + line.subtotal, 0)).toBe(8500);
    expect(lines.map((line) => line.early_check_in_slot)).toEqual(["8-10", "8-10"]);
  });
  it("standard slots add no timing charge", () => {
    expect(bookingTimingFields()).toEqual({ early_check_in: false, early_check_in_slot: null, late_check_out: false, late_check_out_slot: null });
    expect(buildEngineRoomLines(stay)[0].subtotal).toBe(3000);
  });
  it("full-day slots use the selected room's rate", () => {
    expect(buildEngineRoomLines({ ...stay, early: "before-6", late: "after-4pm" })[0].subtotal).toBe(9000);
  });
});