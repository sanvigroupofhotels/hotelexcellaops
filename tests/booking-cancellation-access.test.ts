import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../src/integrations/supabase/client", () => ({ supabase: { rpc } }));
import {
  assertBookingCancellationAllowed,
  BOOKING_CANCELLATION_DENIED,
  isRestrictedBookingStatus,
} from "../src/lib/booking-cancellation-access";

describe("cancellation authorization", () => {
  beforeEach(() => rpc.mockReset());

  it.each(["Cancelled", "No-Show"])("restricts %s", (status) => {
    expect(isRestrictedBookingStatus(status)).toBe(true);
  });
  it.each(["Pending", "Confirmed", "Checked-In", "Checked-Out", "Stay Completed", undefined, null])(
    "leaves %s outside the new restriction", (status) => {
      expect(isRestrictedBookingStatus(status)).toBe(false);
    },
  );
  it("permits a verified owner/admin", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(assertBookingCancellationAllowed()).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("can_cancel_bookings");
  });
  it("rejects staff", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(assertBookingCancellationAllowed()).rejects.toThrow(BOOKING_CANCELLATION_DENIED);
  });
  it("fails closed on missing auth or a failed role check", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not authenticated" } });
    await expect(assertBookingCancellationAllowed()).rejects.toThrow(BOOKING_CANCELLATION_DENIED);
  });
  it("rechecks authorization rather than caching it", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    await assertBookingCancellationAllowed();
    await expect(assertBookingCancellationAllowed()).rejects.toThrow(BOOKING_CANCELLATION_DENIED);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});