import { describe, it, expect } from "vitest";
import { isOtaSystemEmail, normalizeExternalRef } from "./ota-domains";
describe("OTA email blacklist", () => {
  it("blocks FabHotels inventory email", () => expect(isOtaSystemEmail("inventory@fabhotels.com")).toBe(true));
  it("blocks hotelzify domain", () => expect(isOtaSystemEmail("x@hotelzify.com")).toBe(true));
  it("allows a real guest email", () => expect(isOtaSystemEmail("dharma@gmail.com")).toBe(false));
});
describe("external ref normalization", () => {
  it("strips voucher prefix", () => expect(normalizeExternalRef("/Voucher No: JZ3VFO")).toBe("JZ3VFO"));
  it("strips hash", () => expect(normalizeExternalRef("#698957")).toBe("698957"));
});
