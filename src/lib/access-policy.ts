/** Roles must come from the authenticated user's protected role rows. */
export function hasAdministratorAccess(roles: readonly string[]) {
  return roles.some((role) => role === "admin" || role === "owner");
}

export const DEFAULT_ABANDON_MINUTES = 5;

export function inheritedRolePermissions(role: string, matrix: readonly { role_key: string; permission_key: string }[]) {
  return new Set(matrix.filter((row) => row.role_key === role || (role === "owner" && row.role_key === "admin")).map((row) => row.permission_key));
}