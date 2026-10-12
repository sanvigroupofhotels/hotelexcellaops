import { describe, expect, it } from "vitest";
import { houseViewGroupLayout } from "../src/lib/house-view-group-layout";

describe("House View grouped booking display", () => {
  for (const cellW of [184, 140]) {
    it(`keeps October 10–13 spanning three days at cell width ${cellW}`, () => {
      const departed = houseViewGroupLayout(cellW, 1, 0, 2, true);
      const active = houseViewGroupLayout(cellW, 3, 1, 2, true);
      expect(active.left + active.width).toBe(3 * cellW - 2);
      expect(departed.top + departed.height).toBeLessThan(active.top);
    });
    it(`separates two multi-day stays at cell width ${cellW}`, () => {
      const first = houseViewGroupLayout(cellW, 4, 0, 2, true);
      const second = houseViewGroupLayout(cellW, 3, 1, 2, true);
      expect(first.width).toBe(4 * cellW - 4);
      expect(second.width).toBe(3 * cellW - 4);
      expect(first.top + first.height).toBeLessThan(second.top);
    });
    it(`preserves single-day side-by-side grouping at cell width ${cellW}`, () => {
      const first = houseViewGroupLayout(cellW, 1, 0, 2, false);
      const second = houseViewGroupLayout(cellW, 1, 1, 2, false);
      expect(first).toEqual({ left: 2, width: (cellW - 8) / 2 });
      expect(second.left + second.width).toBe(cellW - 2);
    });
  }
  it("preserves clipped edges at both ends of the visible grid", () => {
    expect(houseViewGroupLayout(184, 7, 0, 2, true, true, true).width).toBe(7 * 184);
  });
  it("keeps the overflow action on a separate track within the starting day", () => {
    const booking = houseViewGroupLayout(184, 3, 1, 3, true);
    const overflow = houseViewGroupLayout(184, 1, 2, 3, true);
    expect(booking.top + booking.height).toBeLessThan(overflow.top);
    expect(overflow.left + overflow.width).toBe(182);
    expect(overflow.top + overflow.height).toBeLessThan(3 * 32);
  });
});