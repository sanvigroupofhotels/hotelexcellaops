import { describe, it, expect } from "vitest";
import { parseExtraAdultTag, withExtraAdultTag, stayNights, extraAdultAmount } from "@/lib/extra-adult-charge";

describe("In-House Extra Adult charge", () => {
  it("1 adult × 3 nights @ ₹650 = ₹1,950", () => {
    expect(extraAdultAmount(1, 3, 650)).toBe(1950);
  });
  it("defaults nights to stay length", () => {
    expect(stayNights("2026-10-20", "2026-10-23")).toBe(3);
  });
  it("round-trips adults and nights in notes", () => {
    const n = withExtraAdultTag("sofa bed", 2, 4);
    expect(parseExtraAdultTag(n)).toEqual({ adults: 2, nights: 4 });
    expect(parseExtraAdultTag(withExtraAdultTag(n, 1, 2))).toEqual({ adults: 1, nights: 2 });
  });
});
