import { describe, it, expect } from "vitest";
import {
  normalizePhoneNumber,
  validatePhoneNumber,
  formatPhoneDisplay,
  splitPhone,
  phoneSearchVariants,
  phoneToWaDigits,
} from "@/lib/phone";

describe("phone service — India default", () => {
  it("normalizes plain 10 digits to +91 E.164", () => {
    expect(normalizePhoneNumber("9876543210")).toBe("+919876543210");
    expect(normalizePhoneNumber("098765 43210")).toBe("+919876543210");
    expect(normalizePhoneNumber("+91 98765-43210")).toBe("+919876543210");
  });
  it("validates Indian numbers", () => {
    expect(validatePhoneNumber("9876543210")).toBe(true);
    expect(validatePhoneNumber("12345")).toBe(false);
  });
});

describe("phone service — international", () => {
  it("keeps foreign E.164 numbers intact", () => {
    expect(normalizePhoneNumber("+1 415 555 2671")).toBe("+14155552671");
    expect(normalizePhoneNumber("+44 7400 123456")).toBe("+447400123456");
    expect(validatePhoneNumber("+14155552671")).toBe(true);
    expect(validatePhoneNumber("+971 50 123 4567")).toBe(true);
  });
  it("splits into country + national parts", () => {
    const s = splitPhone("+14155552671");
    expect(s.country).toBe("US");
    expect(s.national.replace(/\D/g, "")).toBe("4155552671");
  });
  it("formats for display and wa.me digits", () => {
    expect(formatPhoneDisplay("+919876543210")).toContain("98765");
    expect(phoneToWaDigits("+14155552671")).toBe("14155552671");
  });
  it("produces search variants for partial lookups", () => {
    const v = phoneSearchVariants("+14155552671");
    expect(v.some((x) => x.includes("4155552671"))).toBe(true);
  });
});
