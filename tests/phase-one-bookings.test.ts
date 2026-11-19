import { describe, expect, it } from "vitest";
import { buildEngineRoomLines } from "@/lib/whatsapp-booking-timing";
import { computePricing } from "@/lib/pricing";
import { planWhatsAppRooms, roomSelectionsSchema } from "@/lib/whatsapp-booking-selection";
import { pushAudienceMatches } from "@/lib/push-audience";

const stay = { check_in: "2026-12-29", check_out: "2027-01-01" };
const categories = ["Oak", "Mapple"].map((type, i) => ({ type, room_type_key: type, available: 5, nights: 3, subtotal: i ? 12000 : 9000, tax_rate: 0.05, nightly: [] }));
describe("Phase 1 room selection and pricing", () => {
  it("rejects Oak 0 and Mapple 0", () => {
    expect(roomSelectionsSchema.safeParse([{ room_type: "Oak", rooms: 0 }, { room_type: "Mapple", rooms: 0 }]).success).toBe(false);
  });
  it("allows one category to remain zero when another has one room", () => {
    expect(roomSelectionsSchema.safeParse([{ room_type: "Oak", rooms: 0 }, { room_type: "Mapple", rooms: 1 }]).success).toBe(true);
  });
  it("aggregates BE-261118-5RIC's two late-checkout rooms without altering ₹6000", () => {
    const pricing = computePricing(buildEngineRoomLines({ ...stay, room_type: "Oak", rooms: 2, guests: 6, rate: 3000, late: "after-4pm" }));
    expect(pricing.additionalLineItems.find((line) => line.unit === "room")).toMatchObject({ quantity: 2, value: 6000 });
  });
  it("aggregates two extra adults for three nights to ₹3000", () => {
    const pricing = computePricing(buildEngineRoomLines({ ...stay, room_type: "Oak", rooms: 2, guests: 6, rate: 3000 }));
    expect(pricing.additionalLineItems.find((line) => line.unit === "adult")).toMatchObject({ quantity: 2, value: 3000 });
  });
  it("charges early check-in for two rooms at ₹1000 each", () => {
    const pricing = computePricing(buildEngineRoomLines({ ...stay, room_type: "Oak", rooms: 2, guests: 4, rate: 3000, early: "6-8" }));
    expect(pricing.additionalLineItems.find((line) => line.unit === "room")).toMatchObject({ quantity: 2, value: 2000 });
  });
  it("preserves negotiated timing discounts across two rooms", () => {
    const lines = buildEngineRoomLines({ ...stay, room_type: "Oak", rooms: 2, guests: 4, rate: 3000, early: "6-8" }).map((line) => ({ ...line, early_check_in_override: 700 }));
    expect(computePricing(lines).additionalLineItems[0]).toMatchObject({ quantity: 2, value: 1400, standardValue: 2000, discount: 600 });
  });
  it("allocates mixed rooms and children once and calculates GST after extras", () => {
    const plan = planWhatsAppRooms({ ...stay, selections: [{ room_type: "Oak", rooms: 1 }, { room_type: "Mapple", rooms: 1 }], categories, adults: 4, children: 2, early: "6-8" });
    expect(plan.items).toHaveLength(2);
    expect(plan.items.reduce((sum, row) => sum + row.adults, 0)).toBe(4);
    expect(plan.items.reduce((sum, row) => sum + row.children, 0)).toBe(2);
    expect(plan.pricing).toMatchObject({ subtotal: 21905, taxes: 1095, total: 23000 });
  });
  it("blocks requests exceeding available rooms", () => {
    expect(() => planWhatsAppRooms({ ...stay, selections: [{ room_type: "Oak", rooms: 6 }], categories, adults: 2, children: 0 })).toThrow("Not enough");
  });
});
describe("Operational push audiences", () => {
  it("operations reaches both admin and front-office staff", () => {
    expect(pushAudienceMatches("operations", ["admin"])).toBe(true);
    expect(pushAudienceMatches("operations", ["fo_staff"])).toBe(true);
    expect(pushAudienceMatches("operations", ["guest"])).toBe(false);
  });
  it("specific-role alerts do not reach another role", () => {
    expect(pushAudienceMatches("admin", ["fo_staff"])).toBe(false);
  });
});