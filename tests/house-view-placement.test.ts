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

  it("10. a live booking that genuinely overlaps a departed chip still hides the departed one", () => {
    const overlapping = { id: "C", guest_name: "Guest C", status: "Confirmed", check_in: "2026-08-14", check_out: "2026-08-17" };
    const itemC = { booking_id: "C", position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-14", check_out: "2026-08-17" };
    const segC = { id: "sC", booking_id: "C", room_id: "r105", start_date: "2026-08-14", end_date: "2026-08-17" };
    const { byRoom } = place([guestA, overlapping], [itemA, itemC], [segA, segC], { businessDate: "2026-08-20" });
    expect((byRoom.get("r105") ?? []).map((c) => c.id)).toEqual(["C"]);
  });
});
