import { describe, expect, it } from "vitest";
import { buildRoomTypeAvailability } from "../src/lib/room-type-availability-core";

const oakRooms = Array.from({ length: 20 }, (_, i) => ({ id: `oak-${i + 1}`, room_type: "Oak" }));

describe("room-type availability", () => {
  it("counts demand from booking item dates, not wider parent booking dates", () => {
    const result = buildRoomTypeAvailability({
      check_in: "2026-08-28",
      check_out: "2026-08-30",
      rooms: oakRooms,
      bookingItems: [
        ...Array.from({ length: 5 }, (_, i) => ({
          booking_id: `early-${i}`,
          room_type: "Oak Room",
          rooms: 1,
          check_in: "2026-08-28",
          check_out: "2026-09-01",
          item_status: "Confirmed",
          bookings: { status: "Full Paid", check_in: "2026-08-28", check_out: "2026-09-01" },
        })),
        ...Array.from({ length: 14 }, (_, i) => ({
          booking_id: `late-${i}`,
          room_type: "Oak Room",
          rooms: 1,
          check_in: "2026-08-30",
          check_out: "2026-09-01",
          item_status: "Confirmed",
          bookings: { status: "Full Paid", check_in: "2026-08-28", check_out: "2026-09-01" },
        })),
      ],
      maintenanceBlocks: Array.from({ length: 5 }, (_, i) => ({
        room_id: `oak-${i + 1}`,
        start_date: "2026-08-28",
        end_date: "2026-08-30",
      })),
    });

    expect(result.byType.Oak).toMatchObject({ total: 20, booked: 5, blocked: 5, available: 10 });
  });

  it("counts live draft holds only for booking engine availability", () => {
    const base = {
      check_in: "2026-08-28",
      check_out: "2026-08-29",
      rooms: oakRooms.slice(0, 2),
      bookingItems: [],
      maintenanceBlocks: [],
      legacyBookings: [
        {
          id: "live-draft",
          room_details: "Oak Room",
          check_in: "2026-08-28",
          check_out: "2026-08-29",
          status: "Draft",
          draft_expires_at: "2026-08-27T00:15:00.000Z",
        },
        {
          id: "expired-draft",
          room_details: "Oak Room",
          check_in: "2026-08-28",
          check_out: "2026-08-29",
          status: "Draft",
          draft_expires_at: "2026-08-26T23:00:00.000Z",
        },
      ],
      nowMs: new Date("2026-08-27T00:00:00.000Z").getTime(),
    };

    expect(buildRoomTypeAvailability({ ...base, includeDraftHolds: false }).byType.Oak.available).toBe(2);
    expect(buildRoomTypeAvailability({ ...base, includeDraftHolds: true }).byType.Oak.available).toBe(1);
  });
});