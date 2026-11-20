import { describe, expect, it } from "vitest";
import { PARSERS, otaSubjectMatches } from "@/lib/ota-email-parser";
import { computePricing, discountPercentage } from "@/lib/pricing";
import { buildEngineRoomLines } from "@/lib/whatsapp-booking-timing";

const body = "NAME OF GUEST: Guest Test\nCHECKIN DATE: 22 NOV 26\nCHECKOUT DATE: 23 NOV 26\nTYPE OF ROOM: Deluxe Room\nTOTAL BOOKING AMOUNT: 1890\nBooking Status: Confirmed";
describe("OTA cancellation events", () => {
  it("reads alphabetic YTIMRR from the cancellation subject and overrides the old table status", () => {
    expect(PARSERS.fabhotels(body, "Cancellation Details For Booking ID:YTIMRR", {}).booking).toMatchObject({ external_ref: "YTIMRR", booking_status: "Cancelled" });
  });
  it("recognizes the cancellation body even when the table still says Confirmed", () => {
    expect(PARSERS.fabhotels(`Booking ID: 2ATAF8\nDear Hotel Partner, Please find below details of your cancellation.\n${body}`, "Booking details", {}).booking?.booking_status).toBe("Cancelled");
  });
  it("accepts cancellation despite confirmation-only subject filters", () => {
    expect(otaSubjectMatches("Cancellation Details For Booking ID:YTIMRR", ["Reservation Confirmed at FabHotel Excella Vizag"])).toBe(true);
    expect(otaSubjectMatches("Promotional offer", ["Reservation Confirmed"])).toBe(false);
  });
});
describe("custom-price discount percentages", () => {
  it("shows 400 and 20 percent for an original 2000 and custom 1600 without changing tax", () => {
    const lines = buildEngineRoomLines({ check_in: "2026-11-22", check_out: "2026-11-23", room_type: "Oak", rooms: 1, guests: 2, rate: 2000 });
    expect(computePricing(lines, 0, 0.05, { totalOverride: 1600 })).toMatchObject({ discount: 400, discountPercent: 20, subtotal: 1600, taxes: 80, total: 1680 });
  });
  it("uses one decimal for fractional discounts", () => { expect(discountPercentage(250, 2000)).toBe(12.5); });
  it("avoids division by zero", () => { expect(discountPercentage(400, 0)).toBe(0); });
});