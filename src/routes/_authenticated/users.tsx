import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

/**
 * `/users` is now a layout for the Users hierarchy:
 *   /users/management — User Management (CRUD)
 *   /users/roles      — Role Management (roles × permission matrix)
 *   /users/access     — Access Management (per-user overrides)
 *
 * Visiting `/users` directly redirects to `/users/management`.
 */
export const Route = createFileRoute("/_authenticated/users")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/users" || location.pathname === "/users/") {
      throw redirect({ to: "/users/management" });
    }
  },
  component: () => <Outlet />,
});
