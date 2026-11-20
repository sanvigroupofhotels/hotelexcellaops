import { describe, expect, it } from "vitest";
import { hasAdministratorAccess, canAccessFrontdeskData, DEFAULT_ABANDON_MINUTES, inheritedRolePermissions } from "@/lib/access-policy";

describe("Owner access and enquiry recovery", () => {
  it("excludes Housekeeping and legacy staff from front-desk data", () => {
    expect(canAccessFrontdeskData(["housekeeping"])).toBe(false);
    expect(canAccessFrontdeskData(["staff"])).toBe(false);
    expect(canAccessFrontdeskData([])).toBe(false);
  });
  it("retains protected Owner, Admin and Front Office access", () => {
    for (const role of ["owner", "admin", "fo_staff", "reception"]) {
      expect(canAccessFrontdeskData([role])).toBe(true);
    }
    expect(canAccessFrontdeskData(["housekeeping", "fo_staff"])).toBe(true);
  });
  it("gives Owner/Admin the same administrator access as Super Admin", () => {
    expect(hasAdministratorAccess(["owner"])).toBe(true);
    expect(hasAdministratorAccess(["admin"])).toBe(true);
    expect(hasAdministratorAccess(["fo_staff", "housekeeping"])).toBe(false);
    expect(hasAdministratorAccess([])).toBe(false);
  });
  it("defaults abandoned-enquiry detection to five minutes", () => {
    expect(DEFAULT_ABANDON_MINUTES).toBe(5);
  });
  it("includes Super Admin grants in the Owner permission preview only", () => {
    const matrix = [{ role_key: "admin", permission_key: "users.manage_users" }, { role_key: "owner", permission_key: "bookings.view" }];
    expect([...inheritedRolePermissions("owner", matrix)].sort()).toEqual(["bookings.view", "users.manage_users"]);
    expect(inheritedRolePermissions("fo_staff", matrix).has("users.manage_users")).toBe(false);
  });
});