import { describe, it, expect } from "vitest";
import { nightsRemaining } from "../src/lib/early-checkout";

describe("early checkout", () => {
  it("counts remaining nights before departure", () => {
    expect(nightsRemaining("2026-10-21", "2026-10-18")).toBe(3);
  });
  it("is zero on the departure date", () => {
    expect(nightsRemaining("2026-10-21", "2026-10-21")).toBe(0);
  });
});
