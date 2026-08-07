import { describe, it, expect } from "vitest";
import {
  spreadHeads,
  spreadHeadsAcross,
  previewAllocation,
  allocateRooms,
  allocateGuestsToLines,
  expandLineToRooms,
  getOccupancyConfig,
  DEFAULT_OCCUPANCY,
} from "../src/lib/guest-allocation";
import { emptyLine, lineSubtotal, type LineItem } from "../src/components/line-items-editor";
import { EXTRA_ADULT_RATE } from "../src/lib/mock-data";

function line(patch: Partial<LineItem>): LineItem {
  return {
    ...emptyLine(),
    check_in: "2026-08-10",
    check_out: "2026-08-11",
    rate: 2500,
    ...patch,
  };
}

describe("Guest Allocation Engine — spread", () => {
  it("5 adults / 2 rooms → 3 + 2", () => {
    expect(spreadHeads(5, 2, 2, 3)).toEqual([3, 2]);
  });
  it("6 adults / 2 rooms → 3 + 3", () => {
    expect(spreadHeads(6, 2, 2, 3)).toEqual([3, 3]);
  });
  it("7 adults / 3 rooms → 3 + 2 + 2", () => {
    expect(spreadHeads(7, 3, 2, 3)).toEqual([3, 2, 2]);
  });
  it("under-occupied party spreads evenly", () => {
    expect(spreadHeads(5, 3, 2, 3)).toEqual([2, 2, 1]);
  });
  it("honours a different room-type capacity", () => {
    expect(spreadHeads(8, 2, 3, 4)).toEqual([4, 4]);
  });
  it("never drops guests above max capacity", () => {
    const a = spreadHeads(9, 2, 2, 3);
    expect(a.reduce((s, x) => s + x, 0)).toBe(9);
  });
});

describe("Guest Allocation Engine — extra adults", () => {
  it("derives extra adults per room from standard occupancy", () => {
    expect(allocateRooms({ room_type: "Oak Room", rooms: 2, adults: 5, children: 0 })).toEqual([
      { adults: 3, children: 0, extra_adults: 1, extra_children: 0 },
      { adults: 2, children: 0, extra_adults: 0, extra_children: 0 },
    ]);
  });
  it("6 adults / 2 rooms → one extra adult in each room", () => {
    const a = allocateRooms({ room_type: "Oak Room", rooms: 2, adults: 6, children: 0 });
    expect(a.map((x) => x.extra_adults)).toEqual([1, 1]);
  });
  it("allocates mixed adults + children", () => {
    const a = allocateRooms({ room_type: "Mapple Room", rooms: 2, adults: 3, children: 3 });
    expect(a.map((x) => x.adults)).toEqual([2, 1]);
    expect(a.map((x) => x.children)).toEqual([2, 1]);
    expect(a.reduce((s, x) => s + x.children, 0)).toBe(3);
  });
  it("falls back to defaults for unknown room types", () => {
    expect(getOccupancyConfig("Nonexistent Suite")).toEqual(DEFAULT_OCCUPANCY);
  });
});

describe("Guest Allocation Engine — line distribution", () => {
  it("sums exactly to the booking-level guest counts", () => {
    const out = allocateGuestsToLines(
      [line({ room_type: "Oak Room", rooms: 2 }), line({ room_type: "Mapple Room", rooms: 1 })],
      { adults: 7, children: 2 },
    );
    expect(out.reduce((s, l) => s + l.adults, 0)).toBe(7);
    expect(out.reduce((s, l) => s + l.children, 0)).toBe(2);
  });

  it("derives line-level extra adults so pricing includes them", () => {
    const [l] = allocateGuestsToLines([line({ room_type: "Oak Room", rooms: 2 })], {
      adults: 5,
      children: 0,
    });
    expect(l.adults).toBe(5);
    expect(l.extra_adults).toBe(1);
    expect(lineSubtotal(l)).toBe(2500 * 2 + EXTRA_ADULT_RATE);
  });

  it("ignores lines with zero rooms", () => {
    const out = allocateGuestsToLines(
      [line({ room_type: "Oak Room", rooms: 0 }), line({ room_type: "Mapple Room", rooms: 2 })],
      { adults: 5, children: 0 },
    );
    expect(out[0].adults).toBe(2); // untouched empty line
    expect(out[1].adults).toBe(5);
  });
});

describe("Guest Allocation Engine — per-room expansion", () => {
  it("expands a multi-room line without duplicating guests", () => {
    const rooms = expandLineToRooms(line({ room_type: "Oak Room", rooms: 2, adults: 5, children: 1 }));
    expect(rooms).toHaveLength(2);
    expect(rooms.map((r) => r.adults)).toEqual([3, 2]);
    expect(rooms.map((r) => r.extra_adults)).toEqual([1, 0]);
    expect(rooms.reduce((s, r) => s + r.adults, 0)).toBe(5);
    expect(rooms.reduce((s, r) => s + r.children, 0)).toBe(1);
    expect(rooms.every((r) => r.rooms === 1)).toBe(true);
  });

  it("7 adults / 3 rooms expands to 3 / 2 / 2 with one extra adult", () => {
    const rooms = expandLineToRooms(line({ room_type: "Oak Room", rooms: 3, adults: 7 }));
    expect(rooms.map((r) => r.adults)).toEqual([3, 2, 2]);
    expect(rooms.reduce((s, r) => s + r.extra_adults, 0)).toBe(1);
  });

  it("keeps manual extra adults on top of derived ones", () => {
    const rooms = expandLineToRooms(line({ room_type: "Oak Room", rooms: 2, adults: 4, extra_adults: 2 }));
    expect(rooms.reduce((s, r) => s + r.extra_adults, 0)).toBe(2);
  });

  it("per-room subtotals reconcile with the line total", () => {
    const l = line({ room_type: "Oak Room", rooms: 2, adults: 5, extra_adults: 1 });
    const rooms = expandLineToRooms(l);
    const sum = rooms.reduce((s, r) => s + lineSubtotal(r), 0);
    expect(sum).toBe(lineSubtotal(l));
  });
});

describe("Guest Allocation Engine — mixed room types", () => {
  it("fills each room to its own configured capacity", () => {
    // Oak 2/3, hypothetical wide type 3/4 via spreadHeadsAcross directly
    expect(spreadHeadsAcross(9, [
      { standard: 2, max: 3 },
      { standard: 3, max: 5 },
    ])).toEqual([3, 5]);
  });

  it("distributes by capacity, not evenly, across mixed lines", () => {
    const out = allocateGuestsToLines(
      [line({ room_type: "Oak Room", rooms: 1 }), line({ room_type: "Mapple Room", rooms: 1 })],
      { adults: 5, children: 0 },
    );
    expect(out.reduce((s, l) => s + l.adults, 0)).toBe(5);
    expect(out.every((l) => l.adults <= 3)).toBe(true);
  });
});

describe("Guest Allocation Engine — preview API", () => {
  it("previews per-room allocation without persisting", () => {
    const p = previewAllocation({
      lines: [{ room_type: "Oak Room", rooms: 2 }, { room_type: "Mapple Room", rooms: 1 }],
      adults: 7,
      children: 2,
    });
    expect(p.totals.rooms).toBe(3);
    expect(p.totals.adults).toBe(7);
    expect(p.totals.children).toBe(2);
    expect(p.lines[0].per_room).toHaveLength(2);
    expect(p.totals.extra_adults).toBe(1);
    expect(p.over_capacity).toBe(false);
  });

  it("flags over-capacity parties", () => {
    const p = previewAllocation({ lines: [{ room_type: "Oak Room", rooms: 1 }], adults: 9, children: 0 });
    expect(p.over_capacity).toBe(true);
    expect(p.totals.adults).toBe(9);
  });
});
