import { describe, expect, it } from "vitest";
import { planBookingItemEdit } from "@/lib/booking-item-edit-plan";
describe("Booking edits preserve physical room identity", () => {
  it("retains the same item after room lines reorder", () => {
    const result = planBookingItemEdit([{ id: "201", room_type: "Oak", assigned_room_id: "room201" }, { id: "202", room_type: "Maple" }], ["Maple Room", "Oak Room"], new Set(["201"]));
    expect(result.matched.map((item) => item?.id)).toEqual(["202", "201"]);
  });
  it("refuses removal of a linked allocation even if its item pointer is empty", () => {
    expect(() => planBookingItemEdit([{ id: "201", room_type: "Oak" }], [], new Set(["201"]))).toThrow();
  });
  it("refuses removal of departed room history", () => {
    expect(() => planBookingItemEdit([{ id: "201", room_type: "Oak", item_status: "Checked-Out" }], [], new Set())).toThrow();
  });
  it("allows removal of an unassigned unused line", () => {
    expect(planBookingItemEdit([{ id: "unused", room_type: "Oak" }], [], new Set()).removableIds).toEqual(["unused"]);
  });
});