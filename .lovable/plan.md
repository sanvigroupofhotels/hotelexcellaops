# Next Phase — Operational Modules Plan

UAT fixes shipped this turn (Cashbook text removed, Quick Actions full-text, Reporting cash report now uses the same `buildDailyCashReport` util as Cashbook, Home Dashboard now includes Revenue Today, New Bookings Today, Occupancy %).

The remaining scope is **three large modules**. I recommend building them in the order below — each is independently shippable and unlocks daily operational value.

---

## Recommended Order

1. **Due Collection Dashboard** (smallest, highest immediate ROI — reuses existing booking + charges data, no new schema)
2. **Issues Consolidation** (medium — extends existing `complaints` table; merges Maintenance via `room_maintenance`)
3. **Staff Attendance & Salary** (largest — net-new domain, 4 new tables, salary engine)

Rationale: 1 and 2 use the data we already have, so they ship in 1–2 turns each. Staff/Salary is a multi-turn build and deserves its own focused phase.

---

## 1. Due Collection Dashboard

**Simplifications**
- No new tables. Compute everything from `bookings` + `booking_charges` + `booking_payments`.
- Reuse existing `AddBookingPaymentModal` for "Add Payment" action.
- Reuse `phone` field + existing WhatsApp helper (`src/components/whatsapp-menu.tsx`) for Call / WhatsApp.

**Page** `/dues`
- Top 3 cards: Total Outstanding · Due Today · Due Tomorrow
- Filter tabs: Due Today | Due Tomorrow | All Dues | In-House | Checked-Out (with due)
- Table rows: Guest · Room · Check-In · Check-Out · Total · Paid · **Due** (highlighted)
- Row actions: Open Booking · Add Payment · Call (tel:) · WhatsApp (wa.me)

**Sidebar** — new "Due Collection" entry under Operations.

---

## 2. Issues (Complaints + Maintenance Consolidation)

**Recommendation**: keep `complaints` as the unified table, deprecate the standalone "Maintenance" surface, and surface `room_maintenance` blocks inside the same Issues page.

**DB changes (one migration)**
- Add `issue_type` enum to `complaints`: `Guest Complaint | Housekeeping | Electrical | Plumbing | AC | TV | WiFi | Furniture | Other`
- Add `resolution_notes text` column
- Keep existing `complaint_categories` master (rename UI label to "Issue Types"); seed the new defaults.
- No data migration needed — existing complaints default to "Guest Complaint".

**UI changes**
- Rename "Complaints" → "Issues" in sidebar and Home stat ("Complaints Open" → "Open Issues").
- Filter chips by issue_type.
- Form gains Issue Type select + Resolution Notes textarea (shown when status moves to Resolved/Closed).
- Home Dashboard "Complaints Open" continues to work — same query.

**Out of scope**: merging `room_maintenance` records into `complaints`. Maintenance blocks rooms (calendar impact); complaints don't. Different domains — link them via a "View related block" affordance, but don't unify schemas.

---

## 3. Staff Attendance & Salary Module

**Simplifications vs Paga**
- One `employees` table extending current `staff` (don't fork — add columns: `employee_code`, `designation`, `department`, `date_of_joining`, `basic_salary`, `monthly_salary`, `food_provided`, `accommodation_provided`).
- Single attendance status per day (Present/Absent/Half/Leave). Defer check-in/out times to a later phase.
- Salary processing = simple monthly snapshot. No tax/PF/ESI calc (out of scope).

**DB — one migration, four new tables**
```text
employees (extends staff)        -- ALTER existing staff table
  + employee_code, designation, department, date_of_joining,
    basic_salary, monthly_salary, food_provided, accommodation_provided

attendance
  id, staff_id, date, status (Present|Absent|HalfDay|Leave),
  check_in_time?, check_out_time?, notes
  UNIQUE(staff_id, date)

salary_advances
  id, staff_id, advance_date, amount, notes, recovered_in_month?

salary_payments
  id, staff_id, month (YYYY-MM), gross, deductions, bonus, incentives,
  net, paid_amount, status (Pending|Partial|Paid), payment_mode, notes

salary_runs (optional, can defer)
  Monthly snapshot — present_days, absent_days, etc.
```

All four tables: standard RLS, `service_role` ALL, `authenticated` SELECT/INSERT/UPDATE/DELETE, scoped to user_id of the hotel.

**Pages**
- `/staff` — extend existing Staff Master with new fields
- `/attendance` — month grid (rows = employees, cols = days), tap a cell to mark
- `/salary` — month picker → table of employees with auto-computed Gross/Deductions/Net, "Process Salary" button per row, "Pay" action
- `/salary/:staff_id/:month` — printable slip
- Reports tab: Attendance Summary · Salary Summary · Pending Salary · Advance Register

**Salary engine (deterministic, no surprises)**
```
gross         = monthly_salary
per_day       = monthly_salary / days_in_month
absent_deduct = per_day × absent_days
halfday_deduct= per_day × 0.5 × half_days
advance_recov = sum(unrecovered advances for this staff)
deductions    = absent_deduct + halfday_deduct + advance_recov + other_deductions
net           = gross + bonus + incentives - deductions
```

---

## Database Considerations

- All new tables: same `user_id` pattern + RLS as existing tables. Standard `GRANT SELECT/INSERT/UPDATE/DELETE TO authenticated; GRANT ALL TO service_role;` block per the project rules.
- `updated_at` triggers reused from `public.set_updated_at()`.
- Audit log: salary_payments + salary_advances should write activity rows (reuse the pattern in `cash_tx_activities`).

---

## Confirmation Needed

Before I start, please confirm:

1. **Order**: proceed in order Due Collection → Issues → Staff/Salary?
2. **Issues consolidation**: keep `room_maintenance` separate (recommended), or also fold maintenance blocks into the unified Issues table?
3. **Salary engine**: is the deterministic formula above acceptable, or do you want configurable rules (e.g. different per-day basis like 26 working days vs calendar days)?
4. **Attendance entry**: month-grid bulk mark (recommended for speed) vs per-day list?

Once confirmed I'll start with Due Collection in the next turn.
