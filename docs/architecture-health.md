# HEOS Core v1.0 — Architecture Health Review

Findings from the post-Shipment 3B review. Recorded as **future
technical debt**, not immediate refactors. The core architecture is
stable; the items below are polish opportunities.

## 1. Duplicated logic (Low)

- **Money formatting** appears both in `Money` component and inline in
  several report tables. Consolidate to one formatter.
- **CSV export** helpers exist per-report; several import
  `lib/csv.ts` but rebuild headers inline. Extract a
  `buildReportExport(columns, rows)` helper.
- **Date range pickers** are consistent (`report-date-range-picker`),
  but a couple of legacy report pages still hand-roll date inputs.

## 2. Tight coupling (Low)

- **`bookings_.$id.tsx`** is a large route module (~2k lines). It
  composes many engines correctly but has grown to be a mini-app. Split
  by tab (Details, Charges, Payments, Room, Activity) into sibling
  components without changing behaviour.
- **`house-view.tsx`** still directly consumes room-inventory + counts
  + HK status. Now that the checkout hook is centralized, the read
  path could move behind a `useHouseViewData()` engine hook.

## 3. Unnecessary complexity (Low)

- **Legacy redirect routes** (`/quote/*`, `/generate`, etc.) exist as
  full files with `<Navigate>`. Once analytics show zero traffic (~90
  days post-v1.0), collapse them into a single splat route.
- **`Route.useRouter()` misuse risk.** No current instances found, but
  onboarding docs should call it out (they now do).

## 4. Maintainability risks (Medium)

- **`bookings_.$id.tsx` size** is the single highest maintainability
  risk. Above split is worth scheduling.
- **Reporting queries in-line.** Some reports run direct
  `supabase.from(...)` queries. Migrate the remaining ones under
  `reporting/*` helpers so date-range and Business-Date logic stay
  centralized.
- **Push subscription cleanup** — expired endpoints are not
  automatically pruned. Add a nightly cron that removes 410-response
  subscriptions.

## 5. Architectural inconsistencies (Low)

- **Some server functions bundle business logic + I/O + validation
  inline.** Standard pattern is validator → engine call → return.
  A pass over `*.functions.ts` for consistency is worth 30 min.
- **`user_permission_overrides`** rows are checked at RPC time but
  there is no UI to bulk-inspect who has overrides. Add an admin
  view under `/users/access`.

## 6. Test coverage (Medium)

- Playwright covers only the House View long-press. Engines are pure
  enough to be worth ~10 Vitest suites (pricing, availability,
  business-date guard, hk-checkout-hook, laundry batch reconciliation,
  night-audit orchestrator, notification routing, csv export,
  activity-log helpers, permission RPC).

## 7. Documentation gaps (Closed by this sprint)

- Full module docs, ER, workflows, navigation, permissions, AI
  roadmap, and developer guide all now exist under `/docs`.
- Follow-up: keep them synced on every schema/permission migration.
  Adding a PR checklist item would enforce this.

## Verdict

**Architecture is stable and safe to extend.** No structural rework
required before starting the Maintenance Module. The items above are
maintenance-grade improvements to be scheduled opportunistically.
