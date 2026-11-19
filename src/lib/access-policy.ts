/** Roles must come from the authenticated user's protected role rows. */
export function hasAdministratorAccess(roles: readonly string[]) {
  return roles.some((role) => role === "admin" || role === "owner");
}

export const DEFAULT_ABANDON_MINUTES = 5;