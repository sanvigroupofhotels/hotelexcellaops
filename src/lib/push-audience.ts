/** Operations is a role group, not a literal subscription role. */
export const OPERATIONS_ROLES = ["admin", "owner", "reception", "fo_staff", "manager", "operations"];
export function pushAudienceMatches(audience: string | null, roles: string[]) {
  return !audience || (audience === "operations" ? roles.some((role) => OPERATIONS_ROLES.includes(role)) : roles.includes(audience));
}