## Phase 3 — Confirmed scope (pre-implementation plan)

### Decisions captured
1. `activity_log` is the single cross-cutting stream. Domain activity tables (booking_activities, complaint_activities, cash_tx_activities, lead_activities, booking_payment_activities, cash_audit_activities) remain unchanged.
2. **Event-style action vocabulary** (past tense, snake_case):
   - Auth: `user_logged_in`, `user_logged_out`
   - Bookings: `booking_created`, `booking_updated`, `booking_moved`, `booking_cancelled`, `booking_no_show`
   - Stay: `guest_checked_in`, `guest_checked_out`, `guest_check_in_reverted`, `guest_check_out_reverted`
   - Payments: `payment_recorded`, `payment_refunded`, `payment_written_off`
   - Night Audit: `night_audit_started`, `night_audit_completed`
   - Customers: `customer_created`, `customer_updated`, `customer_merged`
   - Users/Access: `user_role_changed`, `user_permission_granted`, `user_permission_revoked`
3. Owner login/logout IS tracked. No exclusions.
4. RLS: staff sees only `actor_id = auth.uid()`. Owner/Admin see all (already partly in place — will tighten).

### Schema additions to `activity_log`
- `source` text NOT NULL DEFAULT 'manual' — one of: `manual`, `house_view`, `guest_portal`, `ota`, `night_audit`, `system`, `api`.
- `property_id` uuid NULL — placeholder for future multi-property; indexed.
- Extend `log_activity()` RPC signature with `p_source` (default `'manual'`) and `p_property_id` (default NULL).
- Tighten RLS so staff see only own rows; owner/admin see all (via `has_role`).

### Stay-mutation consolidation (BEFORE instrumentation)
Every write path that changes room/dates routes through `updateBookingStay()`:

| Call site | Current path | After |
|---|---|---|
| House View desktop DnD | `updateBookingStay` ✅ | unchanged |
| House View Move dialog | `updateBookingStay` ✅ | unchanged |
| Booking Detail (`bookings_.$id.tsx`) move/edit dialogs | direct `updateBooking()` | route through `updateBookingStay()` |
| Edit Booking (`bookings_.$id_.edit.tsx`) — stay section | `updateBooking()` | split: stay fields → `updateBookingStay`, other fields → `updateBooking` |
| Check-In / Check-Out flow | direct status update + room assign | extract a sibling `transitionBookingStatus()` (NOT a date/room change — separate from `updateBookingStay`), which calls `updateBookingStay` only when room/dates change at check-in |
| Revert Check-In / Check-Out | direct status update | `transitionBookingStatus()` |
| OTA sync (`booking-engine.functions.ts` / external_bookings) | direct upserts | re-confirm: OTA insert is `createBooking`; OTA stay modifications must call `updateBookingStay` |

`updateBookingStay()` will accept an optional `source` parameter (defaults to `'manual'`; House View passes `'house_view'`, OTA sync passes `'ota'`, etc.) so the activity log shows the origin.

### Instrumentation points (Phase 3.2 — after consolidation)
~12 call sites add `log_activity` calls with the vocabulary above. Detail in next plan iteration after consolidation lands.

### Activity Tracking page (Phase 3.3)
New route `src/routes/_authenticated/reporting.activity.tsx`:
- Filters: actor, role, date range, page, action, source, entity type.
- Columns: Time, Actor, Role, Page, Action, Entity, Summary, Source.
- Row click → drawer with before/after JSON diff.
- CSV export.
- Server-paginated via a new `listActivity()` server function in `src/lib/activity-log.functions.ts`.
- Staff route version hides Actor/Role columns (single-user view) — same component, role-aware.

### Execution order
1. Migration: add `source`, `property_id`, extend `log_activity()`, tighten RLS.
2. Stay consolidation: rewire Booking Detail, Edit Booking, Check-In/Out, Revert flows onto `updateBookingStay()` + new `transitionBookingStatus()`.
3. Add `source` parameter to `updateBookingStay()` and update all call sites.
4. Confirm OTA sync routes stay changes through `updateBookingStay()`.
5. Instrumentation pass (12 call sites).
6. Activity Tracking page + server fn.

### Out of scope
- Historical backfill from per-domain activity tables.
- Diff visualization beyond JSON tree.
- Retiring per-domain activity tables.
- Actual multi-property logic (only the `property_id` column is added).

Proceed?
