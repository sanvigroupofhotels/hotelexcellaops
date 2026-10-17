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
