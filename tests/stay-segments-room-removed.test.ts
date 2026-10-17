import { describe, it, expect } from "vitest";
import { pairStaySlotsToRooms } from "@/lib/stay-segments";

describe("assign → unassign → reassign on arrival day", () => {
  it("shows only the active stay, not the zero-night room_removed history", () => {
    const booking: any = { id: "b1", check_in: "2026-10-14", check_out: "2026-10-16", rooms: 1 };
    const items: any[] = [{ id: "i1", booking_id: "b1", room_type: "Deluxe", check_in: "2026-10-14", check_out: "2026-10-16", item_status: "Checked-In" }];
    const assignments: any[] = [
      { id: "a1", booking_id: "b1", item_id: "i1", room_id: "r103", start_date: "2026-10-14", end_date: "2026-10-14", ended_reason: "room_removed", created_at: "1" },
      { id: "a2", booking_id: "b1", item_id: "i1", room_id: "r103", start_date: "2026-10-14", end_date: null, ended_reason: null, created_at: "2" },
    ];
    const rooms: any[] = [{ id: "r103", room_number: "103", room_type: "Deluxe" }];
    const out: any = pairStaySlotsToRooms(booking, new Map([["b1", items]]), new Map([["b1", assignments]]), rooms);
    const list = Array.isArray(out) ? out : out.paired ?? [];
    expect(list.length).toBe(1);
  });
});

describe("removed items", () => {
  it("removed item with item_removed zero-night segments renders nothing", () => {
    const booking = { id: "b2", check_in: "2026-10-17", check_out: "2026-10-18", room_id: null } as any;
    const items = new Map([["b2", [{ id: "i1", position: 0, rooms: 1, room_type: "Deluxe", item_status: "Removed", check_in: "2026-10-17", check_out: "2026-10-18" }]]]) as any;
    const asg = new Map([["b2", [
      { id: "a1", room_id: "r205", booking_id: "b2", item_id: "i1", start_date: "2026-10-17", end_date: "2026-10-17", ended_reason: "item_removed" },
      { id: "a2", room_id: "r306", booking_id: "b2", item_id: "i1", start_date: "2026-10-17", end_date: "2026-10-17", ended_reason: "item_removed" },
    ]]]) as any;
    const r = pairStaySlotsToRooms(booking, items, asg, [{ id: "r205", room_type: "Deluxe" }, { id: "r306", room_type: "Deluxe" }] as any);
    expect(r.paired).toHaveLength(0);
    expect(r.unpaired).toHaveLength(0);
  });
});
