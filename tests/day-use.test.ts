import { describe, expect, it } from "vitest";
import { billableStayDays, dayUseCheckoutDate, departureAfterDateChange, stayTimeISO } from "../src/lib/day-use";
import { resolveAverageRate } from "../src/lib/rates";
import { buildRoomTypeAvailability } from "../src/lib/room-type-availability-core";
import { canAccessFrontdeskData } from "../src/lib/access-policy";
import { planExpectedTimeSync } from "../src/lib/expected-times";

const day = "2026-11-25";

describe("staff day-use rules", () => {
  it("allows Front Office/Admin/Owner, not housekeeping or public guests", () => {
    expect(["fo_staff", "admin", "owner"].map((role) => canAccessFrontdeskData([role]))).toEqual([true, true, true]);
    expect(canAccessFrontdeskData(["housekeeping"])).toBe(false);
    expect(canAccessFrontdeskData([])).toBe(false);
  });
  it("bills a same-day stay as one full day", () => {
    expect(billableStayDays(day, day)).toBe(1);
    expect(resolveAverageRate("Oak Room", day, day, [{ room_type: "Oak Room", default_rate: 2500, weekday_rate: null, weekend_rate: null, updated_at: "2026-01-01" }], [])).toBe(2500);
  });
  it("defaults departure to 6 PM but retains a staff-selected 1 PM", () => {
    expect(departureAfterDateChange(day, day, "")).toBe("18:00");
    expect(departureAfterDateChange(day, day, "13:00")).toBe("13:00");
    expect(stayTimeISO(day, "18:00")).toBe("2026-11-25T12:30:00.000Z");
  });
  it("counts active day-use demand and releases it after checkout for tonight", () => {
    const base = { check_in: day, check_out: day, rooms: [{ id: "oak-1", room_type: "Oak" }], maintenanceBlocks: [] };
    const item = { booking_id: "day-use", room_type: "Oak", rooms: 1, check_in: day, check_out: day, item_status: "Confirmed", bookings: { status: "Pending" } };
    expect(buildRoomTypeAvailability({ ...base, bookingItems: [item] }).byType["Oak"]?.available).toBe(0);
    expect(buildRoomTypeAvailability({ ...base, check_out: "2026-11-26", bookingItems: [{ ...item, item_status: "Checked-Out", bookings: { status: "Checked-Out" } }] }).byType["Oak"]?.available).toBe(1);
  });
  it("finds the same-day segment for actual checkout when business date has not rolled", () => {
    expect(dayUseCheckoutDate(day, day, "2026-11-24")).toBe(day);
    expect(dayUseCheckoutDate("2026-11-24", "2026-11-26", "2026-11-24")).toBe("2026-11-24");
  });
  it("does not charge overnight early/late fees for day-use hours 9 AM–1 PM or the 6 PM default", () => {
    for (const departure of ["13:00", "18:00"]) {
      const plan = planExpectedTimeSync({ items: [{ id: "i1", rate: 2500, check_in: day, check_out: day }], charges: [], expectedArrival: "09:00", expectedDeparture: departure });
      expect(plan.chargeCreates).toEqual([]);
      expect(plan.itemUpdates).toEqual([]);
    }
  });
});