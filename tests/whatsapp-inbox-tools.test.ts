import { describe, expect, it } from "vitest";
import { LEAD_STAGES, directOfferAmount, leadRoomLines } from "../src/lib/whatsapp-inbox-tools";

describe("inbox booking prefill", () => {
  it("preserves mixed room counts and whole-party guests", () => {
    const lines = leadRoomLines({ room_type_name: "Oak × 1, Mapple × 1", rooms: 2, adults: 4, children: 1, check_in: "2026-11-25", check_out: "2026-11-26" });
    expect(lines.map((l) => [l.room_type, l.rooms])).toEqual([["Oak Room", 1], ["Mapple Room", 1]]);
    expect(lines[1]?.rate).toBe(2750);
    expect(lines.reduce((s, l) => s + l.adults, 0)).toBe(4);
    expect(lines.reduce((s, l) => s + l.children, 0)).toBe(1);
    expect(lines[0]?.check_in).toBe("2026-11-25");
  });
  it("retains explicit room count without a multiplier label", () => {
    expect(leadRoomLines({ room_type_name: "Oak", rooms: 2, adults: 4, children: 0, check_in: null, check_out: null })[0]?.rooms).toBe(2);
  });
  it("accepts direct price only and rejects invalid offers", () => {
    expect(directOfferAmount("2200")).toBe(2200);
    for (const value of ["", "-1", "0", "NaN", "Infinity"]) expect(directOfferAmount(value)).toBeNull();
  });
  it("limits stages to the approved four choices", () => {
    expect([...LEAD_STAGES]).toEqual(["Price Quoted", "Followed Up", "Negotiating", "Call Back Later"]);
  });
});