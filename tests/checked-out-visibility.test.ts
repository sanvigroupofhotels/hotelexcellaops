/**
 * REGRESSION — "Checked-Out room disappears from House View".
 *
 * Root cause: closing an occupancy segment on the arrival date DELETED the row
 * (zero-night range). The departed item then had no segment at all, so the
 * placement engine had nothing to draw on the room lane, and the correct rule
 * "never fake a chip for an unassigned departed item" hid the room entirely.
 *
 * Fix: the segment survives as a closed zero-night segment
 * (`end_date === start_date`). It renders as a one-day departed chip, releases
 * the room the same day, and never blocks a turnover or future arrival.
 */
import { describe, it, expect } from "vitest";
import { placeHouseViewChips, vacateDate, chipsOverlap } from "@/lib/house-view-placement";
import { groupStayAssignments, groupStayItems, pairStaySlotsToRooms } from "@/lib/stay-segments";

const ROOMS = [
  { id: "r403", room_number: "403", room_type: "Oak" },
  { id: "r101", room_number: "101", room_type: "Oak" },
  { id: "r102", room_number: "102", room_type: "Oak" },
  { id: "r103", room_number: "103", room_type: "Oak" },
];

const TODAY = "2026-08-15";

function place(bookings: any[], items: any[], assignments: any[]) {
  return placeHouseViewChips({
    rooms: ROOMS,
    blocks: [],
    rangeStart: "2026-08-12",
    rangeEndExclusive: "2026-08-22",
    lateFractionByBooking: new Map(),
    outgoingLateSeed: new Map(),
    businessDate: TODAY,
    bookings,
    itemsByBooking: groupStayItems(items as any),
    assignmentsByBooking: groupStayAssignments(assignments as any),
  });
}

const departed = (id: string, room: string, ci: string, co: string) => ({
  booking: { id, guest_name: `Guest ${id}`, status: "Checked-Out", check_in: ci, check_out: co },
  item: {
    booking_id: id, position: 0, room_type: "Oak", rooms: 1, check_in: ci, check_out: co,
    item_status: "Checked-Out", checked_out_at: `${TODAY}T06:00:00Z`,
  },
  seg: {
    id: `s${id}`, booking_id: id, room_id: room, start_date: ci,
    end_date: ci === co ? ci : co, ended_reason: "item_check_out",
  },
});

describe("checked-out room stays visible in House View", () => {
  it("1. single-room checkout on a later day remains visible on its room", () => {
    const d = departed("A", "r403", "2026-08-13", TODAY);
    const chips = place([d.booking], [d.item], [d.seg]).byRoom.get("r403") ?? [];
    expect(chips.map((c) => c.id)).toEqual(["A"]);
    expect(chips[0]!._historical).toBe(false);
  });

  it("2. same-day arrival + departure (zero-night segment) still renders one chip", () => {
    const d = departed("A", "r403", TODAY, TODAY);
    const paired = pairStaySlotsToRooms(
      { ...d.booking, room_id: null } as any,
      groupStayItems([d.item] as any),
      groupStayAssignments([d.seg] as any),
      ROOMS,
    ).paired;
    expect(paired).toHaveLength(1);
    expect(paired[0]!.slot.zero_night).toBe(true);

    const chips = place([d.booking], [d.item], [d.seg]).byRoom.get("r403") ?? [];
    expect(chips.map((c) => c.id)).toEqual(["A"]);
    expect(chips[0]!._zeroNight).toBe(true);
  });

  it("3. zero-night departure releases the room on the same date", () => {
    const chip = { check_in: TODAY, check_out: TODAY, status: "Checked-Out", _zeroNight: true };
    expect(vacateDate(chip as any, TODAY)).toBe(TODAY);
    const arrival = { check_in: TODAY, check_out: "2026-08-18", status: "Confirmed" };
    expect(chipsOverlap(chip as any, arrival as any, TODAY)).toBe(false);
  });

  it("4. checked-out room with no new arrival is not dropped and creates no pending TBA", () => {
    const d = departed("A", "r403", TODAY, TODAY);
    const res = place([d.booking], [d.item], [d.seg]);
    expect((res.byRoom.get("r403") ?? []).length).toBe(1);
    expect(res.pendingArrivals).toHaveLength(0);
  });

  it("5. checked-out room followed by a same-day arrival shows sequential turnover", () => {
    const d = departed("A", "r403", "2026-08-13", TODAY);
    const b = { id: "B", guest_name: "Guest B", status: "Confirmed", check_in: TODAY, check_out: "2026-08-18" };
    const itemB = { booking_id: "B", position: 0, room_type: "Oak", rooms: 1, check_in: TODAY, check_out: "2026-08-18" };
    const segB = { id: "sB", booking_id: "B", room_id: "r403", start_date: TODAY, end_date: "2026-08-18" };
    const chips = place([d.booking, b], [d.item, itemB], [d.seg, segB]).byRoom.get("r403") ?? [];
    expect(chips.map((c) => c.id).sort()).toEqual(["A", "B"]);
    expect(chips.find((c) => c.id === "A")!._turnoverDeparture).toBe(true);
    expect(chips.find((c) => c.id === "B")!._turnoverArrival).toBe(true);
  });

  it("6. zero-night departure + same-day arrival both render on the room", () => {
    const d = departed("A", "r403", TODAY, TODAY);
    const b = { id: "B", guest_name: "Guest B", status: "Confirmed", check_in: TODAY, check_out: "2026-08-17" };
    const itemB = { booking_id: "B", position: 0, room_type: "Oak", rooms: 1, check_in: TODAY, check_out: "2026-08-17" };
    const segB = { id: "sB", booking_id: "B", room_id: "r403", start_date: TODAY, end_date: "2026-08-17" };
    const res = place([d.booking, b], [d.item, itemB], [d.seg, segB]);
    expect((res.byRoom.get("r403") ?? []).map((c) => c.id).sort()).toEqual(["A", "B"]);
    expect(res.pendingArrivals).toHaveLength(0);
  });

  it("7. checked-out room followed by a FUTURE arrival keeps both, no clamping", () => {
    const d = departed("A", "r403", "2026-08-13", TODAY);
    const b = { id: "B", guest_name: "Guest B", status: "Confirmed", check_in: "2026-08-18", check_out: "2026-08-20" };
    const itemB = { booking_id: "B", position: 0, room_type: "Oak", rooms: 1, check_in: "2026-08-18", check_out: "2026-08-20" };
    const segB = { id: "sB", booking_id: "B", room_id: "r403", start_date: "2026-08-18", end_date: "2026-08-20" };
    const chips = place([d.booking, b], [d.item, itemB], [d.seg, segB]).byRoom.get("r403") ?? [];
    expect(chips.map((c) => c.id).sort()).toEqual(["A", "B"]);
    expect(chips.find((c) => c.id === "A")!._displayClamped).toBeUndefined();
    expect(chips.find((c) => c.id === "A")!.check_out).toBe(TODAY);
  });

  it("8. multi-room partial checkout: departed room visible, siblings untouched", () => {
    const booking = { id: "M", guest_name: "Multi", status: "Checked-In", check_in: "2026-08-13", check_out: "2026-08-18" };
    const mk = (pos: number, status: string) => ({
      booking_id: "M", position: pos, room_type: "Oak", rooms: 1,
      check_in: "2026-08-13", check_out: "2026-08-18",
      item_status: status,
      checked_out_at: status === "Checked-Out" ? `${TODAY}T06:00:00Z` : null,
    });
    const items = [mk(0, "Checked-In"), mk(1, "Checked-Out"), mk(2, "Checked-In")];
    const segs = [
      { id: "s1", booking_id: "M", room_id: "r101", start_date: "2026-08-13", end_date: "2026-08-18" },
      { id: "s2", booking_id: "M", room_id: "r102", start_date: "2026-08-13", end_date: TODAY, ended_reason: "item_check_out" },
      { id: "s3", booking_id: "M", room_id: "r103", start_date: "2026-08-13", end_date: "2026-08-18" },
    ];
    const res = place([booking], items, segs);
    expect((res.byRoom.get("r101") ?? []).length).toBe(1);
    expect((res.byRoom.get("r103") ?? []).length).toBe(1);
    const departedChip = (res.byRoom.get("r102") ?? [])[0];
    expect(departedChip).toBeTruthy();
    expect(departedChip!.check_out).toBe(TODAY); // segment closed, unchanged
    // siblings still run to the end of the stay
    expect((res.byRoom.get("r101") ?? [])[0]!.check_out).toBe("2026-08-18");
    expect(res.pendingArrivals).toHaveLength(0);
  });

  it("9. no fake chip for an unassigned departed item (the correct rule stays)", () => {
    const booking = { id: "U", guest_name: "Unassigned", status: "Checked-Out", check_in: "2026-08-13", check_out: TODAY };
    const item = {
      booking_id: "U", position: 0, room_type: "Oak", rooms: 1,
      check_in: "2026-08-13", check_out: TODAY, item_status: "Checked-Out", checked_out_at: `${TODAY}T06:00:00Z`,
    };
    const res = place([booking], [item], []);
    expect([...res.byRoom.values()].flat()).toHaveLength(0);
    expect(res.pendingArrivals).toHaveLength(0);
  });

  it("10. a zero-night closed segment does not consume the room for a live sibling slot", () => {
    // Room 403 zero-night departure must leave the lane free for a live arrival.
    const d = departed("A", "r403", TODAY, TODAY);
    const b = { id: "B", guest_name: "Guest B", status: "Confirmed", check_in: TODAY, check_out: "2026-08-17" };
    const itemB = { booking_id: "B", position: 0, room_type: "Oak", rooms: 1, check_in: TODAY, check_out: "2026-08-17" };
    const res = place([d.booking, b], [d.item, itemB], [d.seg]); // B unassigned
    const placedB = [...res.byRoom.entries()].find(([, chips]) => chips.some((c) => c.id === "B"));
    expect(placedB?.[0]).toBe("r403");
    expect(res.pendingArrivals).toHaveLength(0);
  });

  it("11. real checked-out room pointer without segment still renders as a grey departure chip", () => {
    const booking = { id: "L", guest_name: "Legacy Real Room", status: "Checked-Out", check_in: "2026-08-15", check_out: "2026-08-16" };
    const item = {
      id: "item-L", booking_id: "L", position: 0, assigned_room_id: "r403",
      room_type: "Oak", rooms: 1, check_in: "2026-08-15", check_out: "2026-08-16",
      item_status: "Checked-Out", checked_out_at: `${TODAY}T06:00:00Z`,
    };
    const res = place([booking], [item], []);
    const chips = res.byRoom.get("r403") ?? [];
    expect(chips.map((c) => c.id)).toEqual(["L"]);
    expect(chips[0]?._virtual).toBeUndefined();
    expect(chips[0]?._itemStatus).toBe("Checked-Out");
  });

  it("12. fallback checked-out room and same-day arrival render sequentially on same room", () => {
    const departedBooking = { id: "L", guest_name: "Legacy Real Room", status: "Checked-Out", check_in: "2026-08-15", check_out: "2026-08-16" };
    const departedItem = {
      id: "item-L", booking_id: "L", position: 0, assigned_room_id: "r403",
      room_type: "Oak", rooms: 1, check_in: "2026-08-15", check_out: "2026-08-16",
      item_status: "Checked-Out", checked_out_at: `${TODAY}T06:00:00Z`,
    };
    const arrival = { id: "N", guest_name: "Next Guest", status: "Confirmed", check_in: TODAY, check_out: "2026-08-17" };
    const arrivalItem = { id: "item-N", booking_id: "N", position: 0, room_type: "Oak", rooms: 1, check_in: TODAY, check_out: "2026-08-17" };
    const arrivalSeg = { id: "seg-N", booking_id: "N", item_id: "item-N", room_id: "r403", start_date: TODAY, end_date: "2026-08-17" };
    const res = place([departedBooking, arrival], [departedItem, arrivalItem], [arrivalSeg]);
    const chips = res.byRoom.get("r403") ?? [];
    expect(chips.map((c) => c.id).sort()).toEqual(["L", "N"]);
    expect(chips.find((c) => c.id === "L")?._turnoverDeparture).toBe(true);
    expect(chips.find((c) => c.id === "N")?._turnoverArrival).toBe(true);
    expect(res.pendingArrivals).toHaveLength(0);
  });
});
