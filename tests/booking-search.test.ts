import { describe, expect, it } from "vitest";
import { matchesBookingSearch, normDigits, normText } from "../src/lib/booking-search";

/**
 * Shared Search Service regression — every Reception entry point relies on
 * these semantics, so the matcher is pinned here.
 */
const candidate = {
  guest_name: "Manikanta Reddy",
  booking_reference: "HEXB-3BA453",
  phone: "+91 99859 08131",
  occupants: ["Florence D'Souza", null],
  roomNumbers: ["105", "201"],
  company: "Excella Infra Pvt Ltd",
};

describe("shared booking search matcher", () => {
  it("matches the booking holder by partial, case- and space-insensitive name", () => {
    expect(matchesBookingSearch("manikanta", candidate)).toContain("holder");
    expect(matchesBookingSearch("Manikanta Re", candidate)).toContain("holder");
  });

  it("matches the primary occupant", () => {
    expect(matchesBookingSearch("florence", candidate)).toContain("occupant");
  });

  it("matches the mobile number regardless of formatting", () => {
    expect(matchesBookingSearch("9985908131", candidate)).toContain("phone");
    expect(matchesBookingSearch("99859 08131", candidate)).toContain("phone");
  });

  it("matches the booking reference", () => {
    expect(matchesBookingSearch("3ba453", candidate)).toContain("reference");
    expect(matchesBookingSearch("HEXB-3BA", candidate)).toContain("reference");
  });

  it("matches an assigned room number", () => {
    expect(matchesBookingSearch("105", candidate)).toContain("room");
  });

  it("matches the company / group name", () => {
    expect(matchesBookingSearch("excella", candidate)).toContain("company");
  });

  it("ignores blank and too-short queries", () => {
    expect(matchesBookingSearch("", candidate)).toEqual([]);
    expect(matchesBookingSearch("m", candidate)).toEqual([]);
  });

  it("returns no hits for unrelated text", () => {
    expect(matchesBookingSearch("zzzz", candidate)).toEqual([]);
  });

  it("normalises consistently", () => {
    expect(normText("HEXB-3BA453")).toBe("hexb3ba453");
    expect(normDigits("+91 99859-08131")).toBe("919985908131");
  });
});
