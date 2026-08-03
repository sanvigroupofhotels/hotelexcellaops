import { describe, it, expect } from "vitest";
import { cloneStayWindow, normalizeClonedLines } from "@/lib/booking-clone";
import { buildRoomingList } from "@/lib/rooming-list";

describe("clone booking — default dates + commercial extras", () => {
  it("defaults the stay window to today → tomorrow", () => {
    const w = cloneStayWindow();
    expect(w.check_in < w.check_out).toBe(true);
    const ms = new Date(w.check_out).getTime() - new Date(w.check_in).getTime();
    expect(Math.round(ms / 86400000)).toBe(1);
  });

  it("re-dates lines but preserves every commercial extra verbatim", () => {
    const line: any = {
      room_type: "Oak Room",
      rooms: 2,
      adults: 2,
      children: 1,
      check_in: "2024-01-01",
      check_out: "2024-01-05",
      breakfast_included: true,
      extra_bed: 1,
      rate: 7777,
      early_check_in: true,
      early_check_in_slot: "before_9am",
      late_check_out: true,
      late_check_out_slot: "after_4pm",
      pet_size: "small",
      extra_adults: 2,
      drivers: 1,
      notes: "negotiated corporate rate",
    };
    const w = cloneStayWindow();
    const [out] = normalizeClonedLines([line], w);
    expect(out.check_in).toBe(w.check_in);
    expect(out.check_out).toBe(w.check_out);
    expect(out.rate).toBe(7777);
    expect(out.extra_bed).toBe(1);
    expect(out.extra_adults).toBe(2);
    expect(out.pet_size).toBe("small");
    expect(out.early_check_in_slot).toBe("before_9am");
    expect(out.late_check_out_slot).toBe("after_4pm");
    expect(out.drivers).toBe(1);
    expect(out.breakfast_included).toBe(true);
    expect(out.notes).toBe("negotiated corporate rate");
  });
});

describe("rooming list — shared group productivity rows", () => {
  const rooms = [
    { id: "r1", room_number: "201", room_type: "Oak Room" },
    { id: "r2", room_number: "202", room_type: "Oak Room" },
  ];

  it("uses the active occupancy segment for the room number", () => {
    const rows = buildRoomingList({
      items: [
        { id: "i1", room_type: "Oak Room", adults: 2, children: 0, check_in: "2024-05-01", check_out: "2024-05-03", primary_occupant_name: "Asha", item_status: "Checked-In" },
      ],
      rooms,
      activeAssignments: [{ id: "a1", item_id: "i1", room_id: "r2" }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].Room).toBe("202");
    expect(rows[0]["Primary Occupant"]).toBe("Asha");
  });

  it("marks rooms without a segment as Unassigned and excludes Removed items", () => {
    const rows = buildRoomingList({
      items: [
        { id: "i1", room_type: "Oak Room", check_in: "2024-05-01", check_out: "2024-05-02" },
        { id: "i2", room_type: "Oak Room", check_in: "2024-05-01", check_out: "2024-05-02", item_status: "Removed" },
      ],
      rooms,
      activeAssignments: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].Room).toBe("Unassigned");
  });
});
