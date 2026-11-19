import { describe, expect, it } from "vitest";
import { canCaptureWhatsAppLead, canShowWhatsAppPrice } from "@/lib/whatsapp-lead-capture";

describe("WhatsApp contact before prices", () => {
  it("hides prices for selected rooms without a mobile", () => {
    expect(canShowWhatsAppPrice("", 1)).toBe(false);
  });
  it("hides prices for incomplete or invalid mobiles", () => {
    expect(canShowWhatsAppPrice("998590813", 2)).toBe(false);
    expect(canShowWhatsAppPrice("not-a-number", 2)).toBe(false);
  });
  it("requires at least one room even with valid contact", () => {
    expect(canShowWhatsAppPrice("9985908131", 0)).toBe(false);
  });
  it("accepts a valid mobile and one selected room", () => {
    expect(canShowWhatsAppPrice("9985908131", 1)).toBe(true);
  });
  it("captures contact even when the name is not entered", () => {
    expect(canCaptureWhatsAppLead("", "9985908131", 1, "2026-11-28", "2026-11-29")).toBe(true);
  });
});