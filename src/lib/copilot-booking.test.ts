import { describe, it, expect, vi } from "vitest";

const dupMock = vi.fn();
vi.mock("@/lib/booking-duplicates-api", () => ({ checkBookingDuplicates: (i: unknown) => dupMock(i) }));
vi.mock("@/lib/rates-api", () => ({ listRoomRates: async () => [], listRateOverrides: async () => [] }));
vi.mock("@/lib/room-inventory", () => ({ getRoomTypeAvailability: async () => ({}), maxSelectableRooms: () => ({ available: 5 }) }));
vi.mock("@/lib/booking-create", () => ({ submitNewBooking: vi.fn() }));
vi.mock("@/lib/app-settings-api", () => ({ getPaymentSettings: vi.fn(), DEFAULT_PAYMENT_SETTINGS: {} }));

import { buildCopilotPreview } from "./copilot-booking";

const draft = { guest_name: "Raju", phone: "9876543210", check_in: "2026-11-20", check_out: "2026-11-22", adults: 2, rooms: 1, room_type: "Oak Room" } as any;

describe("Copilot duplicate safeguard", () => {
  it("checks the guest's phone and stay dates and attaches matches", async () => {
    dupMock.mockResolvedValueOnce([{ id: "b1", booking_reference: "EXC-1", check_in: "2026-11-21", check_out: "2026-11-23", rooms: [] }]);
    const p = await buildCopilotPreview(draft);
    expect(dupMock).toHaveBeenCalledWith({ phone: "9876543210", checkIn: "2026-11-20", checkOut: "2026-11-22" });
    expect(p.duplicates.map((d) => d.id)).toEqual(["b1"]);
  });
  it("still builds the preview when the duplicate lookup fails", async () => {
    dupMock.mockRejectedValueOnce(new Error("offline"));
    const p = await buildCopilotPreview(draft);
    expect(p.duplicates).toEqual([]);
  });
});
