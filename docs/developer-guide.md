# HEOS Core v1.0 — Developer Guide

Onboarding reference for humans and AI coding assistants. Follow every
convention below unless explicitly justified.

## 1. Stack

- **Runtime.** TanStack Start (React 19, Vite 7) on Cloudflare Workers.
- **Routing.** File-based, `src/routes/`. Never edit
  `src/routeTree.gen.ts`.
- **State/data.** TanStack Query + `createServerFn` for typed RPC.
- **DB.** Supabase (Postgres), RLS enforced.
- **Styling.** Tailwind v4 (`src/styles.css`), shadcn/ui.
- **Language.** TypeScript strict.

## 2. Repository layout

```
src/
  components/    # shared UI, gated by design system
  hooks/         # cross-cutting hooks
  integrations/  # generated Supabase clients — DO NOT EDIT
  lib/           # SHARED ENGINES (business logic)
  routes/        # file-based routing; UI only
  routes/api/    # public HTTP endpoints (webhooks, cron)
docs/            # this baseline documentation
supabase/
  migrations/    # single source of truth for schema
```

## 3. Coding conventions

- **File names.** Kebab-case: `hk-checkout-hook.ts`. React components
  in PascalCase filenames if they are React-exclusive; engine modules
  stay kebab-case.
- **Server-only code.** Files named `*.server.ts` or under
  `*.functions.ts` handler bodies. Never import `.server.ts` from a
  client-bundled path.
- **Env access.** Read `process.env.*` inside handler bodies only.
- **Zod at every boundary.** Server fns use `.inputValidator(z…)`;
  webhook routes verify + parse before use.
- **No hardcoded colors.** Use design tokens defined in
  `src/styles.css`.
- **No trailing slashes** in route paths.
- **No React Router DOM.** Only `@tanstack/react-router`.

## 4. Shared engine philosophy

- One engine per business concept (Booking, HK, Laundry, Cash, …).
- Engines own writes, audit-log emissions, and cross-module effects.
- Screens compose engines; they do not reach into the DB.
- Engines are idempotent: safe to retry on the same payload.
- Cross-module effect? Emit an event/activity row; consuming engine
  subscribes. Do not wire directly.

### When to extend an existing engine

- The new behaviour operates on the same core entity.
- The invariant is already partially expressed in that engine.

### When to introduce a new engine

- A genuinely new business concept enters HEOS (e.g. Maintenance).
- The new logic would require the existing engine to hold two
  responsibilities.
- The new logic has its own tables, permissions, and lifecycle.

## 5. Database migration rules

- **Every `CREATE TABLE public.*` MUST include** in the same migration:
  GRANT statements → RLS enable → policies.
- **`authenticated` for user-facing tables.** Add `anon` only for
  routes that must be public (Booking Engine, portal token exchange).
- **Always include `service_role`** for tables touched by edge/admin
  code.
- **Never alter `auth.*`, `storage.*`, `realtime.*` schemas.**
- **Prefer triggers to `CHECK` constraints** for anything
  time-dependent.
- **Every mutable table gets `update_updated_at_column` trigger.**
- **Deprecations** revoke write grants but leave data for audit; never
  hard-drop production tables.

## 6. RLS conventions

- Everything read-authenticated by default; writes gated by role.
- Use `has_role(auth.uid(), '<role>')` for role checks — never
  correlated subqueries in the policy (recursion risk).
- Use `is_admin()` for the common `owner|admin` case.
- Never store roles on `profiles` or `users` tables — use
  `user_roles`. Enforced.
- Public reads must be scoped to what an anonymous visitor legitimately
  needs (e.g. availability, published rates).

## 7. Permission conventions

- Permission keys live in `public.permissions`.
- Role grants live in `public.role_permissions`.
- Per-user overrides live in `public.user_permission_overrides`.
- Effective set: RPC `my_permissions()`.
- UI gates use `usePermissions().has(key)` / `.hasAny([keys])` — these
  are UX guardrails, not the security perimeter (RLS is).
- Adding a permission requires: migration (permissions +
  role_permissions rows) → sidebar/gate wiring → `docs/permissions.md`
  update.

## 8. Activity logging standards

- Every state transition writes to `activity_log` or an entity-scoped
  `*_activities` table.
- Payloads are JSON: `{ before, after, reason?, actor_context? }`.
- Never bypass — reporting, notifications, and future AI depend on it.
- Read-only pages never emit activity rows.

## 9. Event publishing standards

- Business events are activity rows with a canonical `type` string
  (e.g. `booking.checked_out`, `hk.task_completed`).
- New events: add to `docs/events.md`, document publisher and
  consumers.
- Consumers read the event stream (Realtime subscription or polling).
  Do not modify the publisher for a new consumer.

## 10. Architectural principles

1. Single source of truth per entity.
2. Idempotent operations everywhere.
3. Business Date is authoritative.
4. RLS is the security floor; UI gates are UX guardrails.
5. Extend engines; never patch screens.
6. Every write logs; every log has an actor.
7. Migrations own schema; code never adjusts structure at runtime.

## 11. Testing / verification

- E2E: Playwright specs under `tests/e2e/`.
- Manual UAT for operational flows against localhost.
- No auto-executed unit tests currently — engines are pure enough that
  focused Vitest coverage is a follow-up.

## 12. What NOT to do

- Do not create `src/pages/`. Not a TanStack convention.
- Do not import from `@tanstack/react-router-dom` or anything DOM-
  specific.
- Do not hardcode the Supabase URL, key, or project ref in code —
  read from `import.meta.env.VITE_SUPABASE_*` (client) or
  `process.env.SUPABASE_*` (server).
- Do not expose service-role operations to the client.
- Do not skip GRANTs on new public tables.
- Do not touch generated files.
- Do not add deprecated `reception` / `staff` roles — trigger will
  block writes.
- Do not add code that reads/writes `quotes*` / `followups`.

## 13. Publishing / deployment

- Preview: `id-preview--<id>.lovable.app`.
- Production: `hotelexcellaops.lovable.app` and custom domains.
- Cloudflare Worker runtime; Node compat enabled. See
  `server-runtime` guidance for banned packages.
