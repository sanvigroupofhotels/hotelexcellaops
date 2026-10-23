import { describe, it, expect } from "vitest";
import { nightsRemaining } from "../src/lib/early-checkout";

describe("early checkout", () => {
  it("counts remaining nights before departure", () => {
    expect(nightsRemaining("2026-10-21", "2026-10-18", "2026-10-18")).toBe(3);
  });
  it("is zero on the departure date", () => {
    expect(nightsRemaining("2026-10-21", "2026-10-21", "2026-10-21")).toBe(0);
  });
  it("is zero when calendar date reaches departure even if business date lags", () => {
    expect(nightsRemaining("2026-10-23", "2026-10-22", "2026-10-23")).toBe(0);
  });
  it("detects genuine early departure with lagging business date", () => {
    expect(nightsRemaining("2026-10-26", "2026-10-22", "2026-10-23")).toBe(3);
  });
});
