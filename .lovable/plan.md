
# Shipment Plan — Move Workflow + Activity Tracking

This is a two-track shipment. Track A is concrete behaviour fixes; Track B is a new audit subsystem. I recommend shipping in 3 phases so we keep risk low and review architecture before the big migration.

---

## Phase 1 — Single Source of Truth for Stay Mutations (foundation)

### 1.1 New shared business function

Create `src/lib/booking-stay.functions.ts` exporting one server function:

```
updateBookingStay({ booking_id, new_check_in?, new_check_out?, new_room_id? })
```

Enforces, in this order:
- Booking is in a mutable state (rejects Checked-Out / Stay Completed / Cancelled / No-Show).
- If `status !== 'Checked-In'`: `check_in >= today (Asia/Kolkata)`.
- If `status === 'Checked-In'`: `new_check_in` must equal current check_in (immutable).
- `check_in < check_out`.
- Room availability: reuses existing logic in `bookings-api.ts` plus the trigger guards (`bra_prevent_conflict`, `bookings_prevent_block_conflict`, `bookings_prevent_room_conflict`). On 23514 / `check_violation`, translates the raw error into a friendly message:
  - "Cannot move booking. Destination room is already occupied for the selected dates."
  - "Cannot move booking. Destination room is blocked for maintenance."
  - "Check-in date cannot be in the past."
  - "Check-in must be earlier than check-out."
  - "Check-in date cannot be changed after the guest has checked in."
- Writes `booking_room_assignments` + `bookings.room_id` + dates atomically (same code path as today's `moveMutation`).
- Logs an activity row (see Phase 3) with `before_state` / `after_state`.

### 1.2 Call-site consolidation

Replace inline mutations in:
- `src/routes/_authenticated/house-view.tsx` desktop DnD `moveMutation`
- House View mobile Move dialog
- House View popup (vacant action)
- `bookings_.$id.tsx` (room/date edits)
- `bookings_.$id_.edit.tsx`

All five call `updateBookingStay` via `useServerFn` / `useMutation`.

### 1.3 Available-rooms helper

New helper `listAvailableRoomsForStay({ check_in, check_out, exclude_booking_id })` returns only rooms with:
- no overlapping non-closed booking
- no overlapping `room_maintenance` active block
- no overlapping assignment in `booking_room_assignments`

Used by:
- Mobile Move dialog room dropdown
- Popup room picker
- Edit Booking page room picker

Occupied/blocked rooms are never offered.

---

## Phase 2 — Desktop DnD UX polish

In `house-view.tsx`:

1. **Snap-back animation on failure**: wrap drop handler so chip's transform resets via CSS transition when `moveMutation` rejects. Implementation: keep optimistic transform; on error remove optimistic class, animate `transform: translate(0,0)` over 220ms.
2. **Friendly error toast**: errors from `updateBookingStay` are already humanized in Phase 1; toast uses the translated message.
3. **Drop-target highlighting (optional, included)**: during `dragstart` compute `availableRoomIds` for the dragged booking's stay using `listAvailableRoomsForStay`. Apply `ring-green-500` / `ring-red-500` to row cells; clear on `dragend`. Pure CSS, no library.

No new DnD libraries. Existing HTML5 DnD only.

---

## Phase 3 — Activity Tracking subsystem

### 3.1 Schema (new migration)

We already have `booking_activities`, `booking_payment_activities`, `lead_activities`, `cash_tx_activities`, `complaint_activities`, `cash_audit_activities`. These are domain-specific.

Introduce a single **cross-cutting** table `activity_log` for unified Reports → Activity Tracking. Domain tables stay for detail views and triggers; `activity_log` is the unified stream.

```
activity_log (
  id uuid pk,
  occurred_at timestamptz default now(),
  actor_id uuid null,           -- auth.users.id
  actor_name text,
  actor_role text,              -- owner / admin / staff / system
  page text,                    -- 'House View', 'Bookings', 'End of Day', 'Login', ...
  action text,                  -- 'check_in', 'move_booking', 'create_user', ...
  entity_type text null,        -- 'booking' / 'customer' / 'payment' / 'user' / 'night_audit'
  entity_id uuid null,
  entity_reference text null,   -- HEXB-123 / 22-Jun / etc
  before_state jsonb null,
  after_state jsonb null,
  summary text null,
  metadata jsonb null
)
```

Indexes on `(occurred_at desc)`, `(actor_id, occurred_at desc)`, `(entity_type, entity_id)`.

RLS: `SELECT` for `owner`/`admin` (full), staff sees their own only. `INSERT` via security-definer helper `log_activity(...)` called from server functions. No direct client inserts.

GRANTs per house rules.

### 3.2 Logging helper

`src/lib/activity-log.functions.ts` exports `logActivity({...})` (server fn, `requireSupabaseAuth`). Resolves actor from `context.userId` / profiles / user_roles. Used at every instrumentation point.

### 3.3 Instrumentation points (Phase 3a — high value first)

- **Auth**: subscribe to `supabase.auth.onAuthStateChange` in `__root.tsx`; fire `logActivity({page:'Login', action:'login'|'logout'})` on `SIGNED_IN` / `SIGNED_OUT`. Debounced to skip `TOKEN_REFRESHED`/`INITIAL_SESSION`.
- **House View / Bookings**: `check_in`, `check_out`, `revert_check_in`, `revert_check_out`, `move_booking` (with before/after stay), `create_booking`, `modify_booking`, `cancel_booking`. Hooks into `updateBookingStay` + existing booking mutations.
- **Payments**: `record_payment`, `refund`, `write_off` — instrument `createBookingPayment` / refund path.
- **Night Audit**: `perform_night_audit` (entity_reference = business date), `reopen_night_audit`. Hook into `performNightAuditNow`.
- **Customers**: `create_customer`, `update_email`, `upload_documents` — hook into customers-api + guest-documents upload.
- **User Management**: `create_user`, `change_role`, `disable_user` — hook into `users-admin.functions.ts`.

For domain tables that already audit via DB triggers (booking_payments, complaints, cash_tx, leads), we **mirror** key events into `activity_log` at the server-function layer rather than duplicating triggers. Keeps single source of truth for the unified view while preserving granular per-entity history.

### 3.4 UI

New route: `src/routes/_authenticated/reporting.activity.tsx` linked from Reporting hub.

- Filters: User select (from `profiles` + `user_roles`, grouped by role), Role select, Date range (Today / Yesterday / Last 7 / Custom), Page select, Action select, free-text search.
- Table columns: Time · User · Role · Page · Action · Reference · Details.
- Row click → side drawer with full `before_state` / `after_state` JSON diff (using a small inline diff renderer — no new dep).
- CSV export.
- Server-paginated (50/page).

Admin/Owner only.

### 3.5 Historical data

Not backfilled. Logging starts at the migration timestamp. We can opt to seed from existing `booking_activities` / `booking_payment_activities` / `lead_activities` in a follow-up if useful.

---

## Out of scope / explicitly deferred

- Backfilling historical activity from existing per-domain tables.
- WhatsApp / SMS messaging audit (no current sender).
- Diff visualization beyond JSON tree (can polish later).
- Retiring per-domain activity tables (they remain — `activity_log` is additive).

---

## Effort estimate

| Phase | Effort | Risk |
|---|---|---|
| 1. Shared `updateBookingStay` + call-site consolidation | M | Low — preserves existing trigger behaviour |
| 2. DnD UX (snap-back, highlight) | S | Low |
| 3. Activity Tracking (schema + helper + ~12 instrumentation points + UI) | L | Medium — touches many write paths |

---

## Execution order

Phase 1 → Phase 2 → Phase 3 (schema first, then helper, then instrumentation, then UI).

Please confirm:
1. Approval of `activity_log` as a single cross-cutting stream (additive — keeps domain tables intact).
2. Approval of the action vocabulary in 3.3 (we can expand later).
3. Any actions you'd like dropped from auto-tracking (e.g. you may not want `login` for owners themselves).
4. Whether `staff` should see only their own activity (current proposal) or none at all.
