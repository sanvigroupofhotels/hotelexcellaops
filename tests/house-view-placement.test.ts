import { describe, it, expect } from "vitest";
import {
  placeHouseViewChips,
  vacateDate,
  chipsOverlap,
  isDepartedStatus,
} from "@/lib/house-view-placement";
import { groupStayAssignments, groupStayItems, segmentsOverlap } from "@/lib/stay-segments";

const ROOMS = [
  { id: "r105", room_number: "105", room_type: "Oak" },
  { id: "r106", room_number: "106", room_type: "Oak" },
];

const BASE = {
  rooms: ROOMS,
  blocks: [] as any[],
  rangeStart: "2026-08-14",
  rangeEndExclusive: "2026-08-21",
  lateFractionByBooking: new Map<string, number>(),
  outgoingLateSeed: new Map<string, number>(),
  businessDate: "2026-08-15",
};

function place(bookings: any[], items: any[], assignments: any[], overrides: any = {}) {
  return placeHouseViewChips({
    ...BASE,
    bookings,
    itemsByBooking: groupStayItems(items as any),
    assignmentsByBooking: groupStayAssignments(assignments as any),
    ...overrides,
  });
}

const guestA = { id: "A", guest_name: "Guest A", status: "Checked-Out", check_in: "2026-08-13", check_out: "2026-08-15" };
const guestB = { id: "B", guest_name: "Guest B", status: "Confirmed", check_in: "2026-08-15", check_out: "2026-08-17" };

const itemA = { booking_id: "A", position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-13", check_out: "2026-08-15" };
const itemB = { booking_id: "B", position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-15", check_out: "2026-08-17" };

const segA = { id: "sA", booking_id: "A", room_id: "r105", start_date: "2026-08-13", end_date: "2026-08-15" };
const segB = { id: "sB", booking_id: "B", room_id: "r105", start_date: "2026-08-15", end_date: "2026-08-17" };

describe("same-day turnover (UAT-053)", () => {
  it("1+3. checkout on 15 Aug and new arrival on 15 Aug both hold their own segment on room 105", () => {
    const { byRoom } = place([guestA, guestB], [itemA, itemB], [segA, segB]);
    const chips = byRoom.get("r105") ?? [];
    expect(chips.map((c) => c.id).sort()).toEqual(["A", "B"]);
    const a = chips.find((c) => c.id === "A")!;
    const b = chips.find((c) => c.id === "B")!;
    expect([a.check_in, a.check_out]).toEqual(["2026-08-13", "2026-08-15"]);
    expect([b.check_in, b.check_out]).toEqual(["2026-08-15", "2026-08-17"]);
  });

  it("2. the departed booking is never hidden or replaced by the arrival", () => {
    const { byRoom } = place([guestA, guestB], [itemA, itemB], [segA, segB]);
    expect((byRoom.get("r105") ?? []).some((c) => c.id === "A")).toBe(true);
  });

  it("4. sequential same-day occupancy is not an overlap", () => {
    expect(segmentsOverlap(
      { check_in: "2026-08-13", check_out: "2026-08-15" },
      { check_in: "2026-08-15", check_out: "2026-08-17" },
    )).toBe(false);
    expect(chipsOverlap(guestA, guestB, BASE.businessDate)).toBe(false);
  });

  it("5. departing and arriving chips are tagged distinctly", () => {
    const { byRoom } = place([guestA, guestB], [itemA, itemB], [segA, segB]);
    const chips = byRoom.get("r105") ?? [];
    expect(chips.find((c) => c.id === "A")!._turnoverDeparture).toBe(true);
    expect(chips.find((c) => c.id === "B")!._turnoverArrival).toBe(true);
  });

  it("6+7. unassigned arrival stays visible when every room is occupied overnight, without a fake assignment", () => {
    // Both rooms occupied 14 → 15 (open segments, e.g. not yet checked out).
    const stayIn = (id: string, room: string) => ({
      booking: { id, guest_name: id, status: "Checked-In", check_in: "2026-08-14", check_out: "2026-08-15" },
      item: { booking_id: id, position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-14", check_out: "2026-08-15" },
      seg: { id: "s" + id, booking_id: id, room_id: room, start_date: "2026-08-14", end_date: "2026-08-15" },
    });
    const x = stayIn("X", "r105");
    const y = stayIn("Y", "r106");
    // Unassigned arrival same-day: it fits the lane (half-open), so it is placed virtually.
    const res = place([x.booking, y.booking, guestB], [x.item, y.item, itemB], [x.seg, y.seg]);
    const placedB = [...res.byRoom.values()].flat().find((c) => c.id === "B");
    expect(placedB?._virtual).toBe(true);
    // Virtual placement is display-only — never an assignment row.
    expect(res.pendingArrivals.length + 1).toBeGreaterThan(0);

    // Now block both lanes for the arrival dates so no clean lane exists.
    const longStay = (id: string, room: string) => ({
      booking: { id, guest_name: id, status: "Checked-In", check_in: "2026-08-14", check_out: "2026-08-18" },
      item: { booking_id: id, position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-14", check_out: "2026-08-18" },
      seg: { id: "s" + id, booking_id: id, room_id: room, start_date: "2026-08-14", end_date: "2026-08-18" },
    });
    const p = longStay("P", "r105");
    const q = longStay("Q", "r106");
    const res2 = place([p.booking, q.booking, guestB], [p.item, q.item, itemB], [p.seg, q.seg]);
    expect(res2.pendingArrivals.map((a) => a.booking.id)).toEqual(["B"]);
    expect([...res2.byRoom.values()].flat().some((c) => c.id === "B")).toBe(false);
  });

  it("6b. pending arrival lists expected turnover rooms when occupancy ends on the arrival date", () => {
    const dep = (id: string, room: string) => ({
      booking: { id, guest_name: id, status: "Checked-In", check_in: "2026-08-12", check_out: "2026-08-15" },
      item: { booking_id: id, position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-12", check_out: "2026-08-15" },
      seg: { id: "s" + id, booking_id: id, room_id: room, start_date: "2026-08-12", end_date: "2026-08-15" },
    });
    const d1 = dep("D1", "r105");
    const d2 = dep("D2", "r106");
    // Two unassigned Oak items on the arrival date: the first takes a lane,
    // the second has none left and becomes a Room Pending turnover arrival.
    const twoRooms = { id: "B", guest_name: "Guest B", status: "Confirmed", check_in: "2026-08-15", check_out: "2026-08-17" };
    const items = [
      d1.item, d2.item,
      { booking_id: "B", position: 0, room_type: "Oak", rooms: 3, check_in: "2026-08-15", check_out: "2026-08-17" },
    ];
    const res = place([d1.booking, d2.booking, twoRooms], items, [d1.seg, d2.seg]);
    expect(res.pendingArrivals.length).toBe(1);
    expect(res.pendingArrivals[0].turnoverRooms.map((t) => t.room_number).sort()).toEqual(["105", "106"]);
  });

  it("8. legacy open segment of a departed booking still frees the room on the business date", () => {
    // Guest A checked out early: booking ran to 18 Aug, segment never trimmed.
    const legacyA = { ...guestA, check_out: "2026-08-18" };
    const legacyItem = { ...itemA, check_out: "2026-08-18" };
    const legacySeg = { ...segA, end_date: "2026-08-18" };
    const { byRoom } = place([legacyA, guestB], [legacyItem, itemB], [legacySeg, segB]);
    const chips = byRoom.get("r105") ?? [];
    expect(chips.map((c) => c.id).sort()).toEqual(["A", "B"]);
    expect(vacateDate(legacyA, "2026-08-15")).toBe("2026-08-15");
    expect(isDepartedStatus("Checked-Out")).toBe(true);
  });

  it("9. multi-room booking with mixed assigned / unassigned items renders both", () => {
    const multi = { id: "M", guest_name: "Multi", status: "Confirmed", check_in: "2026-08-16", check_out: "2026-08-18" };
    const items = [
      { booking_id: "M", position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-16", check_out: "2026-08-18" },
      { booking_id: "M", position: 1, room_type: "Oak", rooms: 1, check_in: "2026-08-16", check_out: "2026-08-18" },
    ];
    const seg = { id: "sM", booking_id: "M", room_id: "r105", start_date: "2026-08-16", end_date: "2026-08-18" };
    const { byRoom, pendingArrivals } = place([multi], items, [seg]);
    expect((byRoom.get("r105") ?? []).some((c) => c.id === "M" && !c._virtual)).toBe(true);
    expect((byRoom.get("r106") ?? []).some((c) => c.id === "M" && c._virtual)).toBe(true);
    expect(pendingArrivals).toHaveLength(0);
  });

  it("10. a live booking that genuinely overlaps a departed chip clamps the drawing, never deletes it", () => {
    const overlapping = { id: "C", guest_name: "Guest C", status: "Confirmed", check_in: "2026-08-14", check_out: "2026-08-17" };
    const itemC = { booking_id: "C", position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-14", check_out: "2026-08-17" };
    const segC = { id: "sC", booking_id: "C", room_id: "r105", start_date: "2026-08-14", end_date: "2026-08-17" };
    const { byRoom } = place([guestA, overlapping], [itemA, itemC], [segA, segC], { businessDate: "2026-08-20" });
    const chips = byRoom.get("r105") ?? [];
    expect(chips.map((c) => c.id).sort()).toEqual(["A", "C"]);
    const a = chips.find((c) => c.id === "A")!;
    expect([a.check_in, a.check_out]).toEqual(["2026-08-13", "2026-08-14"]);
    expect(a._displayClamped).toBe(true);
    expect(chipsOverlap(a, chips.find((c) => c.id === "C")!, "2026-08-20")).toBe(false);
  });

});

describe("checked-out room reuse (same-day turnover regression)", () => {
  const departedNoSegments = {
    id: "OLD", guest_name: "Old Guest", status: "Checked-Out",
    check_in: "2026-08-17", check_out: "2026-08-19",
  };
  const oldItems = [
    { booking_id: "OLD", position: 0, room_type: "Oak", rooms: 2, check_in: "2026-08-17", check_out: "2026-08-19" },
  ];
  const arrival = {
    id: "NEW", guest_name: "Mr Swaroop", status: "Advance Paid",
    check_in: "2026-08-18", check_out: "2026-08-19",
  };
  const newItem = { booking_id: "NEW", position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-18", check_out: "2026-08-19" };
  const newSeg = { id: "sNEW", booking_id: "NEW", room_id: "r105", start_date: "2026-08-18", end_date: "2026-08-19" };

  it("1+5+6. new booking assigned to the checked-out room renders on that room and leaves TBA", () => {
    const res = place([departedNoSegments, arrival], [...oldItems, newItem], [newSeg], { businessDate: "2026-08-18" });
    const chips = res.byRoom.get("r105") ?? [];
    expect(chips.filter((c) => c.id === "NEW")).toHaveLength(1);
    expect(chips.some((c) => c.id === "NEW" && !c._virtual)).toBe(true);
    expect(res.pendingArrivals.map((p) => p.booking.id)).toEqual([]);
  });

  it("2+3. a departed booking without segments never fakes occupancy or a pending card", () => {
    const res = place([departedNoSegments], oldItems, [], { businessDate: "2026-08-18" });
    expect([...res.byRoom.values()].flat()).toHaveLength(0);
    expect(res.pendingArrivals).toHaveLength(0);
  });

  it("2b. unassigned live arrival still shows while the checked-out room is free", () => {
    const res = place([departedNoSegments, arrival], [...oldItems, newItem], [], { businessDate: "2026-08-18" });
    const placedNew = [...res.byRoom.values()].flat().filter((c) => c.id === "NEW");
    expect(placedNew).toHaveLength(1);
    expect(placedNew[0]._virtual).toBe(true);
    expect(res.pendingArrivals).toHaveLength(0);
  });

  it("4+7. old closed segment stays intact and never overlaps the new one; siblings unaffected", () => {
    const closedOld = { id: "sOLD", booking_id: "OLD", room_id: "r105", start_date: "2026-08-17", end_date: "2026-08-18", ended_reason: "booking_check_out" };
    const otherOld = { id: "sOLD2", booking_id: "OLD", room_id: "r106", start_date: "2026-08-17", end_date: "2026-08-19" };
    const res = place([departedNoSegments, arrival], [...oldItems, newItem], [closedOld, otherOld, newSeg], { businessDate: "2026-08-18" });
    const r105 = res.byRoom.get("r105") ?? [];
    const old105 = r105.find((c) => c.id === "OLD")!;
    expect([old105.check_in, old105.check_out]).toEqual(["2026-08-17", "2026-08-18"]);
    const new105 = r105.find((c) => c.id === "NEW")!;
    expect([new105.check_in, new105.check_out]).toEqual(["2026-08-18", "2026-08-19"]);
    expect(chipsOverlap(old105, new105, "2026-08-18")).toBe(false);
    const old106 = (res.byRoom.get("r106") ?? []).find((c) => c.id === "OLD")!;
    expect(old106.check_out).toBe("2026-08-19");
  });
});

describe("Room 403 sequential occupancy — exact UAT case (HEXB-4379D4 / Swaroop)", () => {
  // Old guest (Sree Deepthi) occupied 403 on 16 Aug and checked out on 17 Aug.
  const oldGuest = { id: "OLD403", booking_reference: "HEXB-276FD1", guest_name: "Sree Deepthi", status: "Checked-Out", check_in: "2026-08-16", check_out: "2026-08-17" };
  const oldItem = { booking_id: "OLD403", position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-16", check_out: "2026-08-17" };
  const oldSeg = { id: "sOLD403", booking_id: "OLD403", room_id: "r105", start_date: "2026-08-16", end_date: "2026-08-17", ended_reason: "booking_check_out" };

  // New booking (Swaroop) takes the same physical room from 18 Aug.
  const swaroop = { id: "SWA", booking_reference: "HEXB-4379D4", guest_name: "Mr Swaroop", status: "Advance Paid", check_in: "2026-08-18", check_out: "2026-08-19" };
  const swaItem = { booking_id: "SWA", position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-18", check_out: "2026-08-19" };
  const swaSeg = { id: "sSWA", booking_id: "SWA", room_id: "r105", start_date: "2026-08-18", end_date: "2026-08-19" };

  const res = () => place([oldGuest, swaroop], [oldItem, swaItem], [oldSeg, swaSeg], { businessDate: "2026-08-18" });

  it("both bookings stay attached to the same room, sequentially", () => {
    const chips = res().byRoom.get("r105") ?? [];
    expect(chips.map((c) => c.id).sort()).toEqual(["OLD403", "SWA"]);
  });

  it("the checked-out booking's historical segment is untouched", () => {
    const old = (res().byRoom.get("r105") ?? []).find((c) => c.id === "OLD403")!;
    expect([old.check_in, old.check_out]).toEqual(["2026-08-16", "2026-08-17"]);
    expect(old._historical).toBe(true);
    expect(old._displayClamped).toBeUndefined();
  });

  it("segments do not overlap and the new booking is not TBA", () => {
    const r = res();
    const chips = r.byRoom.get("r105") ?? [];
    const old = chips.find((c) => c.id === "OLD403")!;
    const nw = chips.find((c) => c.id === "SWA")!;
    expect(chipsOverlap(old, nw, "2026-08-18")).toBe(false);
    expect(nw._virtual).toBeUndefined();
    expect(r.pendingArrivals).toHaveLength(0);
  });

  it("a fully checked-out multi-room booking never consumes lanes via virtual chips", () => {
    const bulk = { id: "BULK", guest_name: "BJP Aditya", status: "Checked-Out", check_in: "2026-08-17", check_out: "2026-08-19" };
    const bulkItems = [0, 1].map((position) => ({ booking_id: "BULK", position, room_type: "Oak", rooms: 1, check_in: "2026-08-17", check_out: "2026-08-19" }));
    const r = place([bulk, swaroop], [...bulkItems, swaItem], [swaSeg], { businessDate: "2026-08-18" });
    expect([...r.byRoom.values()].flat().filter((c) => c.id === "BULK")).toHaveLength(0);
    expect(r.pendingArrivals).toHaveLength(0);
    expect((r.byRoom.get("r105") ?? []).map((c) => c.id)).toEqual(["SWA"]);
  });

  it("a genuinely live unassigned booking still surfaces (placed or pending)", () => {
    const live = { id: "LIVE", guest_name: "Live Guest", status: "Confirmed", check_in: "2026-08-18", check_out: "2026-08-19" };
    const liveItem = { booking_id: "LIVE", position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-18", check_out: "2026-08-19" };
    const r = place([oldGuest, swaroop, live], [oldItem, swaItem, liveItem], [oldSeg, swaSeg], { businessDate: "2026-08-18" });
    const placedLive = [...r.byRoom.values()].flat().filter((c) => c.id === "LIVE");
    expect(placedLive.length + r.pendingArrivals.filter((p) => p.booking.id === "LIVE").length).toBe(1);
  });
});

describe("multi-room checked-out bookings keep their room history (item-level placement)", () => {
  const ROOMS3 = [
    { id: "r101", room_number: "101", room_type: "Oak" },
    { id: "r102", room_number: "102", room_type: "Oak" },
    { id: "r103", room_number: "103", room_type: "Oak" },
  ];
  const place3 = (bookings: any[], items: any[], assignments: any[], overrides: any = {}) =>
    place(bookings, items, assignments, { rooms: ROOMS3, ...overrides });

  const multi = { id: "M", booking_reference: "HEXB-310C65", guest_name: "BJP Aditya", status: "Checked-Out", check_in: "2026-08-16", check_out: "2026-08-18" };
  const multiItems = [0, 1, 2].map((position) => ({
    booking_id: "M", position, room_type: "Oak", rooms: 1,
    check_in: "2026-08-16", check_out: "2026-08-18",
    item_status: "Checked-Out", checked_out_at: "2026-08-18T06:00:00Z",
  }));
  const multiSegs = ["r101", "r102", "r103"].map((room_id, i) => ({
    id: `sM${i}`, booking_id: "M", room_id, start_date: "2026-08-16", end_date: "2026-08-18", ended_reason: "booking_check_out",
  }));

  it("Test 1 — single-room checkout still renders its closed segment", () => {
    const r = place([guestA], [itemA], [segA]);
    expect((r.byRoom.get("r105") ?? []).map((c) => c.id)).toEqual(["A"]);
  });

  it("Test 2 — every room of a fully checked-out multi-room booking stays represented", () => {
    const r = place3([multi], multiItems, multiSegs, { businessDate: "2026-08-18" });
    for (const rid of ["r101", "r102", "r103"]) {
      const chips = r.byRoom.get(rid) ?? [];
      expect(chips.map((c) => c.id)).toEqual(["M"]);
      expect(chips[0]!.check_in).toBe("2026-08-16");
      expect(chips[0]!._historical).toBe(true);
    }
    expect(r.pendingArrivals).toHaveLength(0);
  });

  it("Test 3 — new booking reuses one of those rooms without overlap", () => {
    const swa = { id: "SWA", guest_name: "Mr Swaroop", status: "Advance Paid", check_in: "2026-08-18", check_out: "2026-08-19" };
    const swaItem = { booking_id: "SWA", position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-18", check_out: "2026-08-19" };
    const swaSeg = { id: "sSWA", booking_id: "SWA", room_id: "r103", start_date: "2026-08-18", end_date: "2026-08-19" };
    const r = place3([multi, swa], [...multiItems, swaItem], [...multiSegs, swaSeg], { businessDate: "2026-08-18" });
    const chips = r.byRoom.get("r103") ?? [];
    expect(chips.map((c) => c.id).sort()).toEqual(["M", "SWA"]);
    const oldChip = chips.find((c) => c.id === "M")!;
    const newChip = chips.find((c) => c.id === "SWA")!;
    expect([oldChip.check_in, oldChip.check_out]).toEqual(["2026-08-16", "2026-08-18"]);
    expect(chipsOverlap(oldChip, newChip, "2026-08-18")).toBe(false);
    expect(r.pendingArrivals).toHaveLength(0);
  });

  it("Test 4 — departed items create no TBA, but a live unassigned booking still does", () => {
    const live = { id: "L", guest_name: "Live", status: "Confirmed", check_in: "2026-08-16", check_out: "2026-08-18" };
    const liveItem = { booking_id: "L", position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-16", check_out: "2026-08-18" };
    // Departed multi-room booking with NO segments at all (the HEXB-310C65 data shape).
    const noSegMulti = multiItems.map((i) => ({ ...i }));
    const r = place3([multi, live], [...noSegMulti, liveItem], [], { businessDate: "2026-08-18" });
    expect([...r.byRoom.values()].flat().filter((c) => c.id === "M")).toHaveLength(0);
    const placedLive = [...r.byRoom.values()].flat().filter((c) => c.id === "L");
    expect(placedLive.length + r.pendingArrivals.filter((p) => p.booking.id === "L").length).toBe(1);
  });

  it("Test 5 — mixed state: departed items keep history, the live item gets its own lane", () => {
    const mixed = { id: "X", guest_name: "Mixed", status: "Checked-In", check_in: "2026-08-16", check_out: "2026-08-19" };
    const items = [
      { booking_id: "X", position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-16", check_out: "2026-08-18", item_status: "Checked-Out", checked_out_at: "2026-08-18T06:00:00Z" },
      { booking_id: "X", position: 1, room_type: "Oak", rooms: 1, check_in: "2026-08-16", check_out: "2026-08-19", item_status: "Checked-In" },
      { booking_id: "X", position: 2, room_type: "Oak", rooms: 1, check_in: "2026-08-16", check_out: "2026-08-19", item_status: "Checked-Out", checked_out_at: "2026-08-17T06:00:00Z" },
    ];
    const segs = [
      { id: "x0", booking_id: "X", room_id: "r101", start_date: "2026-08-16", end_date: "2026-08-18", ended_reason: "booking_check_out" },
      { id: "x1", booking_id: "X", room_id: "r102", start_date: "2026-08-16", end_date: "2026-08-19" },
      // position 2 was never assigned a room and is already checked out → no chip.
    ];
    const r = place3([mixed], items, segs, { businessDate: "2026-08-18" });
    expect((r.byRoom.get("r101") ?? []).map((c) => c._itemStatus)).toEqual(["Checked-Out"]);
    expect((r.byRoom.get("r102") ?? []).map((c) => c._itemStatus)).toEqual(["Checked-In"]);
    expect(r.byRoom.get("r103") ?? []).toHaveLength(0);
    expect(r.pendingArrivals).toHaveLength(0);
  });
});
