# Next Phase — Issues + Staff Attendance & Salary

Production fixes shipped this turn alongside this plan:

- **Multi-room Check-In (server-side)**: new BEFORE-UPDATE trigger `bookings_enforce_full_assignment_on_checkin` rejects any status transition to `Checked-In` when assigned rooms < required rooms (sum of `booking_items.rooms`). Direct API calls cannot bypass the UI guard anymore.
- **House View → multi-room aware**: now reads `booking_room_assignments` and renders the booking on every assigned room. Falls back to legacy `bookings.room_id` for older single-room bookings. Occupancy, vacant count and in-house room list all derive from assignments.
- **Quick Actions**: cards now stack icon + label vertically (`min-h-[96px]`, centered, larger emoji, wrapping label). All eight labels visible on 360px mobile without truncation.
- **Today's Cash Report (Reporting)**: already shares `buildDailyCashReport` with Cashbook — confirmed single source of truth.

Two open clarifications below the plan.

---

## Recommended Order

1. **Issues Module** (small — extends `complaints`, 1 migration, ~2 hours of UI)
2. **Staff Attendance & Salary** (large — 4 new tables + 4 new pages, multi-turn)

Rationale: Issues reuses existing `complaints` infra (table, RLS, audit trigger, sidebar entry). Staff is a net-new domain and deserves its own focused phase.

---

## 1. Issues Module (Unified)

**Approach**: rename "Complaints" → "Issues" everywhere. Add `issue_type` enum and `resolution_notes` to the existing `complaints` table. Keep `room_maintenance` (calendar blocks) as a separate concern — different domain (blocks calendar/inventory). Surface a "Block Room" affordance from inside an Issue when needed.

### DB (one migration)

```sql
CREATE TYPE issue_type AS ENUM (
  'Guest Complaint','Housekeeping','Maintenance','Electrical',
  'Plumbing','AC','TV','WiFi','Furniture','Other'
);
ALTER TABLE complaints
  ADD COLUMN issue_type issue_type NOT NULL DEFAULT 'Guest Complaint',
  ADD COLUMN resolution_notes text;
```

No data migration — existing rows default to "Guest Complaint".

### UI

- Sidebar: "Complaints" → "Issues".
- Home stat "Complaints Open" → "Open Issues" (same query — Open + In Progress).
- Issues list: filter chips for Issue Type + Status. Search by room, guest, description.
- Issue form: Issue Type select, Resolution Notes textarea (appears when status → Resolved/Closed).
- Statuses unchanged: Open → In Progress → Resolved → Closed.

---

## 2. Staff Attendance & Salary

### Simplifications

- **Extend `staff`** (don't fork) with: `employee_code`, `designation`, `department`, `date_of_joining`, `basic_salary`, `monthly_salary`, `food_provided`, `accommodation_provided`, `mobile`.
- **One status per day** for attendance (Present | Absent | HalfDay | Leave). Check-in/out times are optional columns for later.
- **Working-days basis configurable in `app_settings`**: `30` (default) or `calendar`. Drives the per-day rate.
- **Salary engine = deterministic** (no PF/ESI/tax — out of scope):

```
per_day      = monthly_salary / (basis === '30' ? 30 : days_in_month)
absent_ded   = per_day × absent_days
halfday_ded  = per_day × 0.5 × half_days
advance_rec  = SUM(advances WHERE recovered_in_month = this_month)
deductions   = absent_ded + halfday_ded + advance_rec + other_deductions
net          = monthly_salary + bonus + incentives − deductions
```

### DB (one migration, four tables)

```text
staff (ALTER)
  + employee_code text, designation text, department text,
    date_of_joining date, mobile text,
    basic_salary numeric, monthly_salary numeric,
    food_provided bool default false,
    accommodation_provided bool default false

attendance
  id, user_id, staff_id, date, status (enum), check_in_time?, check_out_time?, notes
  UNIQUE(staff_id, date)

salary_advances
  id, user_id, staff_id, advance_date, amount, notes,
  recovered_in_month text NULL    -- 'YYYY-MM' once recovered

salary_payments
  id, user_id, staff_id, month text ('YYYY-MM'),
  gross numeric, bonus numeric, incentives numeric,
  absent_days int, halfday_count int, leave_days int,
  absent_deduction numeric, halfday_deduction numeric,
  advance_recovery numeric, other_deductions numeric,
  net numeric, paid_amount numeric default 0,
  status text ('Pending'|'Partial'|'Paid'),
  payment_mode text, paid_at timestamptz, notes
  UNIQUE(staff_id, month)
```

All four: standard RLS (`auth.uid() = user_id`), `GRANT SELECT/INSERT/UPDATE/DELETE TO authenticated`, `GRANT ALL TO service_role`. Reuse `set_updated_at()` trigger.

### Pages

- **`/staff`** — extend existing Staff Master with new fields (employee_code, designation, etc.).
- **`/attendance`** — month-grid (rows = active employees, cols = days). Tap a cell to cycle P→A→H→L. Mark-all-present for a column. **Default = month grid for speed**; per-day list available as a secondary view.
- **`/salary`** — month picker → table with auto-computed Gross/Deductions/Net per employee. "Process" creates the `salary_payments` row. "Pay" records the payment.
- **`/salary/$staff_id/$month`** — printable slip with the full breakdown (PDF via `window.print()` — same pattern as the Invoice dialog).
- **`/staff/$id/ledger`** — chronological view: salary credits + advances + payments. Running balance.
- **Reports tab** (under Reporting): Attendance Summary · Salary Summary · Pending Salary · Advance Register.

### Audit & Activity

Reuse the `cash_tx_activities` / `booking_payment_activities` pattern: `salary_payment_activities` records create / pay / status_change events with actor identity, so the ledger has a real audit trail.

---

## Open Clarifications

1. **Check-In Welcome WhatsApp** — production finding "Update checkin welcome message too" — what content change? The current message points to `hotelexcella.in/guest` + order food + breakfast line. Should I align it with the new Confirmation Message style (greetings, booking ref block, payment summary), or do you have specific new copy?
2. **Staff `mobile` already exists?** — current `staff` table has 7 columns, will check during migration; if `mobile` is missing I'll add it, otherwise skip.

Once you confirm (1) and (2), I'll proceed in this order: **Issues → Staff (schema + Master) → Attendance grid → Salary engine → Slip + Reports.**
