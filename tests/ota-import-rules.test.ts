import { describe, expect, it } from "vitest";
import { buildOtaImport, resolveOtaRooms, otaPaymentAmount } from "@/lib/ota-import-rules";
import { computePricing } from "@/lib/pricing";
import { canCaptureWhatsAppLead } from "@/lib/whatsapp-lead-capture";
import { parseGeneric, HOTELZIFY_DEFAULTS, PARSERS } from "@/lib/ota-email-parser";
import { resolveNotificationRoute } from "@/lib/notification-routing";

const booking = { room_details: "3 Deluxe Room", guests: 5, check_in: "2026-11-28", check_out: "2026-12-01", total_amount: 14601, payment_mode: "Pay @ Hotel" };
describe("OTA import rules", () => {
  it("parses future providers using configured aliases", () => {
    const email = "Reservation code: ABC123\nTraveller: Guest Test\nArrive: 2026-11-28\nDepart: 2026-12-01\nUnits: 3\nCategory: Deluxe Room\nHeads: 5\nGross: 14601\nSettlement: Prepaid";
    const parsed = parseGeneric(email, "Confirmed reservation", HOTELZIFY_DEFAULTS, {
      booking_id: ["Reservation code"], guest_name: ["Traveller"], check_in: ["Arrive"], check_out: ["Depart"],
      rooms: ["Units"], room_details: ["Category"], guests: ["Heads"], total_amount: ["Gross"], payment_mode: ["Settlement"],
    }, { statusFromSubject: true });
    expect(parsed.booking).toMatchObject({ rooms: "3", payment_mode: "Prepaid", total_amount: 14601, guests: 5 });
  });
  it("parses FabHotels room prefix and GST-inclusive money, not tax percentages", () => {
    const parsed = PARSERS.fabhotels("Booking ID: TU7C6I\nNAME OF GUEST: AVIJIT MAITY\nCHECKIN DATE: 28 NOV 26\nCHECKOUT DATE: 01 DEC 26\nTOTAL GUESTS: 5\nTYPE OF ROOM: 3 Deluxe Room\nTOTAL BOOKING AMOUNT: ₹14,601\nPAYMENT MODE: Prepaid\nTax (5%): 695", "Reservation Confirmed", {});
    expect(parsed.booking).toMatchObject({ total_amount: 14601, room_details: "3 Deluxe Room", payment_mode: "Prepaid", check_in: "2026-11-28" });
  });
  it("expands three Deluxe rooms for five guests using canonical allocation", () => {
    const plan = buildOtaImport(booking, 0.05);
    expect(plan.items.map((i) => i.adults)).toEqual([2, 2, 1]);
    expect(plan.items.map((i) => i.rooms)).toEqual([1, 1, 1]);
    expect(plan.items.map((i) => i.room_type)).toEqual(["Oak Room", "Oak Room", "Oak Room"]);
  });
  it("mapped room count takes precedence over the name prefix", () => {
    expect(resolveOtaRooms("3 Deluxe Room", "2", { "Deluxe Room": "Custom Category" })).toEqual({ rooms: 2, room_type: "Custom Category" });
  });
  it("keeps the email total inclusive of GST without a second levy", () => {
    const plan = buildOtaImport({ ...booking, total_amount: 2500 }, 0.05);
    expect(plan.pricing).toMatchObject({ subtotal: 2381, taxes: 119, total: 2500 });
    expect(computePricing(plan.items, { taxRate: 0.05, totalOverride: 2500, taxesIncluded: true }).total).toBe(2500);
  });
  it("records the full email amount only for prepaid", () => { expect(otaPaymentAmount("Prepaid", 14601)).toBe(14601); });
  it("does not guess a Part Pay advance", () => { expect(otaPaymentAmount("Part Pay", 14601)).toBe(0); });
  it("leaves Pay @ Hotel fully due", () => { expect(otaPaymentAmount("Pay @ Hotel", 14601)).toBe(0); });
  it("does not mistake not prepaid or online for prepaid", () => {
    expect(otaPaymentAmount("Not Prepaid", 14601)).toBe(0);
    expect(otaPaymentAmount("online", 14601)).toBe(0);
  });
  it("rejects malformed room count instead of importing one room", () => { expect(() => resolveOtaRooms("Deluxe Room", "0")).toThrow(); });
});
describe("WhatsApp unfinished request capture", () => {
  it("opens abandoned WhatsApp alerts in the WhatsApp inbox", () => {
    expect(resolveNotificationRoute({ entity_type: "customer", entity_id: "customer", metadata: { source_channel: "WhatsApp", lead_id: "lead" } })).toBe("/whatsapp-inbox");
  });
  it("captures a contactable request as soon as one room is selected", () => {
    expect(canCaptureWhatsAppLead("Guest Test", "9985908131", 1, "2026-11-28", "2026-11-29")).toBe(true);
  });
  it("does not create an enquiry before a room is selected", () => {
    expect(canCaptureWhatsAppLead("Guest Test", "9985908131", 0, "2026-11-28", "2026-11-29")).toBe(false);
  });
  it("does not fabricate contact details for anonymous selections", () => {
    expect(canCaptureWhatsAppLead("", "", 1, "2026-11-28", "2026-11-29")).toBe(false);
  });
});