import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { phoneKey, staysOverlap, isActiveForDuplicates } from "./booking-duplicates-api";

describe("duplicate booking rules", () => {
  it("matches phones on last 10 digits", () => {
    expect(phoneKey("+91 99859-08131")).toBe("9985908131");
    expect(phoneKey("12345")).toBeNull();
  });
  it("treats overlapping dates as duplicates", () => {
    expect(staysOverlap("2026-11-16", "2026-11-18", "2026-11-17", "2026-11-19")).toBe(true);
  });
  it("back-to-back stays are not duplicates", () => {
    expect(staysOverlap("2026-11-16", "2026-11-18", "2026-11-18", "2026-11-20")).toBe(false);
  });
  it("ignores cancelled and no-show bookings", () => {
    expect(isActiveForDuplicates("Cancelled")).toBe(false);
    expect(isActiveForDuplicates("No-Show")).toBe(false);
    expect(isActiveForDuplicates("Confirmed")).toBe(true);
  });
});
