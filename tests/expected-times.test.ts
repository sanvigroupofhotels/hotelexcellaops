import { describe, it, expect } from "vitest";
import {
  resolveEarlyCheckInWindow,
  resolveLateCheckOutWindow,
  planExpectedTimeSync,
  EARLY_CHECK_IN_CATEGORY,
  LATE_CHECK_OUT_CATEGORY,
} from "@/lib/expected-times";

const item = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, rate: 4000, ...over }) as any;

describe("expected-time windows", () => {
  it("maps arrival times to the correct early check-in slot", () => {
    expect(resolveEarlyCheckInWindow("05:00")?.slot).toBe("before-6");
    expect(resolveEarlyCheckInWindow("07:15")?.slot).toBe("6-8");
    expect(resolveEarlyCheckInWindow("09:30")?.slot).toBe("8-10");
    expect(resolveEarlyCheckInWindow("11:00")?.slot).toBe("10-13");
    // at/after standard check-in → no early charge
    expect(resolveEarlyCheckInWindow("13:00")).toBeNull();
    expect(resolveEarlyCheckInWindow("15:00")).toBeNull();
    expect(resolveEarlyCheckInWindow("")).toBeNull();
  });

  it("maps departure times to the correct late check-out slot", () => {
    expect(resolveLateCheckOutWindow("11:00")).toBeNull();
    expect(resolveLateCheckOutWindow("13:30")?.slot).toBe("upto-2pm");
    expect(resolveLateCheckOutWindow("15:45")?.slot).toBe("2-4pm");
    expect(resolveLateCheckOutWindow("18:00")?.slot).toBe("after-4pm");
  });

  it("full-day windows fall back to the room rate", () => {
    const plan = planExpectedTimeSync({
      items: [item("i1", { rate: 5200 })],
      charges: [],
      expectedDeparture: "18:00",
      syncEarly: false,
    });
    expect(plan.chargeCreates).toHaveLength(1);
    expect(plan.chargeCreates[0].unit_price).toBe(5200);
    expect(plan.chargeCreates[0].category).toBe(LATE_CHECK_OUT_CATEGORY);
  });
});

describe("planExpectedTimeSync", () => {
  it("creates one charge per selected room only (multi-room fan-out)", () => {
    const plan = planExpectedTimeSync({
      items: [item("i1"), item("i2"), item("i3")],
      charges: [],
      expectedArrival: "09:00",
      applyItemIds: ["i1", "i3"],
      syncLate: false,
    });
    expect(plan.chargeCreates.map((c) => c.item_id)).toEqual(["i1", "i3"]);
    expect(plan.chargeCreates.every((c) => c.category === EARLY_CHECK_IN_CATEGORY)).toBe(true);
  });

  it("is idempotent — re-running with the same time creates nothing", () => {
    const first = planExpectedTimeSync({
      items: [item("i1")],
      charges: [],
      expectedArrival: "09:00",
      syncLate: false,
    });
    const charges = first.chargeCreates.map((c, i) => ({
      id: `c${i}`,
      item_id: c.item_id,
      category: c.category,
      quantity: c.quantity,
      unit_price: c.unit_price,
    }));
    const second = planExpectedTimeSync({
      items: [item("i1")],
      charges,
      expectedArrival: "09:00",
      syncLate: false,
    });
    expect(second.chargeCreates).toHaveLength(0);
    expect(second.chargeUpdates).toHaveLength(0);
    expect(second.chargeDeletes).toHaveLength(0);
  });

  it("re-prices in place when the guest changes the expected time", () => {
    const charges = [
      { id: "c1", item_id: "i1", category: EARLY_CHECK_IN_CATEGORY, quantity: 1, unit_price: 500 },
    ];
    const plan = planExpectedTimeSync({
      items: [item("i1")],
      charges,
      expectedArrival: "05:00", // full-day window
      syncLate: false,
    });
    expect(plan.chargeCreates).toHaveLength(0);
    expect(plan.chargeUpdates).toHaveLength(1);
    expect(plan.chargeUpdates[0].unit_price).toBe(4000);
  });

  it("removes the charge when the time no longer qualifies", () => {
    const plan = planExpectedTimeSync({
      items: [item("i1")],
      charges: [
        { id: "c1", item_id: "i1", category: LATE_CHECK_OUT_CATEGORY, quantity: 1, unit_price: 1000 },
      ],
      expectedDeparture: "10:00",
      syncEarly: false,
    });
    expect(plan.chargeDeletes).toEqual(["c1"]);
  });

  it("never double-charges when the quote already priced the extra", () => {
    const plan = planExpectedTimeSync({
      items: [item("i1", { late_check_out: true, late_check_out_slot: "upto-2pm" })],
      charges: [],
      expectedDeparture: "15:00",
      syncEarly: false,
    });
    expect(plan.chargeCreates).toHaveLength(0);
    // window re-priced on the item instead
    expect(plan.itemUpdates[0].patch).toMatchObject({ late_check_out_slot: "2-4pm" });
  });

  it("ignores removed rooms", () => {
    const plan = planExpectedTimeSync({
      items: [item("i1", { item_status: "Removed" }), item("i2")],
      charges: [],
      expectedArrival: "09:00",
      syncLate: false,
    });
    expect(plan.chargeCreates.map((c) => c.item_id)).toEqual(["i2"]);
  });
});
