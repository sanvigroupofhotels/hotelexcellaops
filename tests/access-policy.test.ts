import { describe, expect, it } from "vitest";
import { hasAdministratorAccess, DEFAULT_ABANDON_MINUTES } from "@/lib/access-policy";

describe("Owner access and enquiry recovery", () => {
  it("gives Owner/Admin the same administrator access as Super Admin", () => {
    expect(hasAdministratorAccess(["owner"])).toBe(true);
    expect(hasAdministratorAccess(["admin"])).toBe(true);
    expect(hasAdministratorAccess(["fo_staff", "housekeeping"])).toBe(false);
    expect(hasAdministratorAccess([])).toBe(false);
  });
  it("defaults abandoned-enquiry detection to five minutes", () => {
    expect(DEFAULT_ABANDON_MINUTES).toBe(5);
  });
});