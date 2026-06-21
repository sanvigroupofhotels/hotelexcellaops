
# Night Audit v2 — Implementation Plan

> Approved redesign. Plan only — no code written yet. Will execute in phases on your go-ahead.

---

## A. Immediate UAT finding — Check-In flow gap

### Diagnosis (verified in code)

Today's Night Audit Check-In (`night-audit-dialog.tsx` → `handleCheckIn`) only checks **room assignments**, then mutates status. The Booking Page Check-In (`bookings_.$id.tsx` → `handleCheckInClick`) does much more:

1. **OTA phone gate** — blocks Check-In if OTA source + no valid 10-digit phone.
2. **Guest documents gate** — opens `GuestDocumentsDialog` (ID upload) if no docs on file.
3. **Room assignment** — opens `RoomAssignmentDialog` in `checkin-flow` mode if unassigned.
4. **Status mutation** — `setBookingStatus("Checked-In")` only after all gates pass.

Night Audit currently does step 3 + 4 only — that's why "the flow feels incomplete."

### Fix (Phase 1 of build)

Extract the entire flow into a single reusable hook + controller:

```text
src/lib/check-in-flow.ts
  - useCheckInController({ bookingId, onCheckedIn })
  - returns { start(), dialogs: <…all gates JSX…> }
  - encapsulates: OTA phone gate → documents gate → room assignment → status mutate → activity log
```

Then **Night Audit, Booking Page, House View popup, and Dashboard Today's Arrivals** all call `controller.start(bookingId)` and render `controller.dialogs` once. One implementation, one bug surface, one UX.

Acceptance: clicking Check-In from Night Audit shows the exact same dialogs (phone gate → docs → rooms) as the Booking Page. Verified in UAT scenario §H.1.

---

## B. Permissions model (no new role)

Reuse existing `owner | admin | staff` via `role_permissions` table:

| Permission key | owner | admin | staff |
|---|---|---|---|
| `night_audit.view` | ✓ | ✓ | ✓ |
| `night_audit.resolve` (CI / CO / Cancel / NoShow / Record Payment) | ✓ | ✓ | ✓ |
| `night_audit.close` | ✓ | ✓ | ✗ |
| `night_audit.advance_business_date` (= close gate) | ✓ | ✓ | ✗ |
| `night_audit.reopen` | ✓ | ✓ | ✗ |
| `night_audit.override` | ✓ | ✓ | ✗ |

Seeded in the same migration that creates sessions.

---

## C. Data model (migrations)

### C.1 `night_audit_sessions`

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| business_date | date | unique with `status <> 'closed'` (one open per BD) |
| status | text | `open` \| `in_progress` \| `closed` |
| opened_by, opened_at | uuid, timestamptz | |
| closed_by, closed_at | uuid, timestamptz | nullable |
| advanced_to | date | nullable, set on close |
| override_by, override_reason | uuid, text | when closed with exceptions |
| reopened_by, reopened_at, reopen_reason | | nullable, set on reopen |
| cash_variance, cash_variance_reason | numeric, text | nullable |
| totals | jsonb | snapshot of EOD numbers at close |
| eod_html | text | rendered HTML at close (used for view + PDF) |

Unique partial index: `(business_date) WHERE status <> 'closed'`.

### C.2 `night_audit_decisions`

Append-only log of every action taken in a session.

| column | type |
|---|---|
| id, session_id, booking_id (nullable) | uuid |
| step | text — `arrivals` \| `inhouse` \| `departures` \| `dues` \| `reconciliation` \| `close` \| `reopen` |
| action | text — `check_in` \| `check_out` \| `cancel` \| `no_show` \| `record_payment` \| `extend_stay` \| `change_room` \| `override` \| `close` \| `reopen` \| `cash_variance_logged` |
| before_status, after_status | text (nullable) |
| actor_id, actor_name, actor_role | |
| note | text (override reason, variance reason, etc.) |
| created_at | timestamptz |

### C.3 Forward-going invariant — booking ↔ customer phone

(Already promised in the previous turn. Bundled into this migration.)

1. Trigger `bookings_ensure_customer` (BEFORE INSERT/UPDATE):
   - Canonicalize `phone` via `normalize_phone_in`.
   - If `customer_id` IS NULL **or** `customer.phone ≠ booking.phone`: find-by-phone → else create from `(guest_name, phone, email)` → set `customer_id`.
2. Same logic for `quotes_ensure_customer` (idempotent re-check; existing `link_or_create_customer` covers the create case but does not re-link on phone change).
3. **Backfill** in the same migration: detect mismatches, auto-fix when a phone-matching customer exists, leave a `data_quality_findings` row for the rest (admin UI in Phase 5).

### C.4 Cron disabled

- `/api/public/night-audit` is rewritten to **never advance BD or change statuses**. It only:
  - Inserts a reminder row in `crm_outbound_emails` (or new `dashboard_alerts` table) when the current BD has no open/closed session past 22:00 IST.
  - Returns the same `ok: false, reason: 'audit_required'` shape so monitoring still works.
- The pg_cron entry is left in place (just a heartbeat now). Documented in plan/runbook.

---

## D. Server functions (`src/lib/night-audit.functions.ts`)

All `createServerFn` + `requireSupabaseAuth`, with permission checks inside.

- `getOrOpenSession(businessDate)` — finds or creates the open session for BD.
- `listSessionView(sessionId)` — returns Arrivals / In-House / Departures / Dues lists in one round-trip.
- `recordDecision(sessionId, …)` — append-only log helper used by every action.
- `setVariance(sessionId, cashVariance, reason)`.
- `closeSession(sessionId, { override, reason })` — checks exceptions, applies override gate, advances BD atomically, closes cash audit for BD, snapshots totals, renders + stores EOD HTML, logs decision.
- `reopenLastSession({ reason })` — owner/admin only; rolls BD back, deactivates cash audit close for that BD, logs decision; refuses if the BD it would roll back to is not the most recently closed one.
- `getEodReport(sessionId)` — returns stored HTML + computed totals.

All check-in / check-out / cancel / no-show / record-payment go through **existing** server-side paths (no duplication); Night Audit just calls them and writes a `night_audit_decisions` row via `recordDecision`.

---

## E. UI — "Reception Command Center"

Route: `src/routes/_authenticated/night-audit.tsx` (promote from dialog to a full page). Existing `NightAuditDialog` is kept as a thin shortcut that links here.

### E.1 Page shell

```text
┌──────────────────────────────────────────────────────────────┐
│ Business Date: 21-Jun-2026   Next: 22-Jun-2026               │
│ Session: In Progress · opened 22:14 by Dileep                │
│ [Reopen last closed]   [Close & Advance →] (perm-gated)      │
├─────────┬─────────┬─────────┬──────┬──────────────┬──────────┤
│Arrivals │In-House │Departures│ Dues │Reconciliation│  Review  │
│   (N)   │   (N)   │   (N)    │ (N)  │              │ + EOD    │
└─────────┴─────────┴─────────┴──────┴──────────────┴──────────┘
```

Tabs (badges show counts). Each tab is a panel component.

### E.2 Arrivals tab

**Rule (per your modification):** `check_in <= business_date` AND `status NOT IN ('Checked-In','Cancelled','No-Show')`.

Columns: Guest · Phone · Source · Rooms (assigned / required) · Advance Due · ETA · Status pill · **Actions**.

Row badges (subtle, multi-tag):
- `OTA` (source ≠ Direct/Walk-In)
- `Walk-in` (created during this session)
- `Rooms missing` (assignments < required)
- `Advance due ₹X`

Actions:
- **Check-In** → calls the unified `useCheckInController` (the §A fix).
- **No-Show** → only visible when `check_out < business_date` (unchanged rule).
- **Cancel** → confirm dialog.
- **Assign Rooms** → opens `RoomAssignmentDialog` directly when only rooms are missing.
- **Record Advance** → opens the existing add-payment modal.

### E.3 In-House tab

Source: `bookings WHERE status = 'Checked-In' AND check_in <= BD AND check_out > BD`.
Columns: Room # · Guest · CI · CO · Nights · Outstanding · Extra charges · Actions.

Actions: **Check-Out** (reuses existing flow with overpayment/refund/admin-override path from Booking page), **Extend Stay** (opens edit), **Change Room** (`RoomAssignmentDialog` mode=`change`), **Record Payment**, **Add Charge**.

### E.4 Departures tab

Source: `status = 'Checked-In' AND check_out <= BD`.
Columns: Room # · Guest · CO · Outstanding · Actions.

Actions: **Check-Out**, **Record Payment**, **Extend Stay**, **Late Check-Out** (no extra night; logged), **Mark Stay-Completed** (admin override for stuck rows).

### E.5 Dues tab

All bookings with `balance_due > 0` reaching BD (active states only). Inline **Record Payment** modal.

### E.6 Reconciliation tab

Three cards (read-only computed + one input each):

- **Occupancy** — rooms occupied (from in-house list) vs physical rooms not in maintenance. Variance highlighted, no input.
- **Revenue** — Σ folio charges vs Σ payments for BD; expected outstanding vs actual dues.
- **Cash drawer** — Σ `cash_transactions` for BD (system) · reception's declared cash (input) · **Variance** (auto) · **Reason** (textarea). Saving here writes a `cash_variance_logged` decision; does NOT block close (per your decision §4).

### E.7 Review & Close

- Summary counts: Arrivals X/Y, In-House Z, Departures resolved A/B, Dues cleared C/D, Exceptions E.
- If E > 0 and user lacks `night_audit.override`: button is disabled with a clear message.
- If E > 0 and user has `override`: prompt for **Override Reason** (required) before close.
- On **Close & Advance**: server `closeSession` → BD = BD+1, cash audit close set to BD, EOD snapshot + HTML stored, session row stamped `closed`.

### E.8 EOD report

- HTML view rendered server-side from the stored snapshot, embedded in a new tab `/_authenticated/reporting/night-audit/$sessionId` (printable via `window.print()`).
- **PDF download** uses browser print-to-PDF via a hidden `<iframe>` and `react-to-print` (no Node-only deps). If the user prefers server-rendered PDF, we can swap to `@react-pdf/renderer` (pure JS, Worker-safe) in a follow-up.
- Sections: Header (hotel, BD, session, actors) · Arrivals · Departures · In-House snapshot · Occupancy %, ADR, RevPAR · Revenue by mode · Cash drawer + variance · Exceptions · Decisions log.

### E.9 Reopen flow

- "Reopen last closed" button on the page header — owner/admin only.
- Prompt for mandatory reason → server `reopenLastSession` → BD rollback, cash audit close deactivation, decisions logged, new session row re-opened in `in_progress` state for that BD.
- Refuses with a clear error if the target BD is not the most recently closed.

---

## F. Permission wiring

- Seed `night_audit.*` keys into `permissions` table; map to `role_permissions` per §B.
- Use existing `<PermissionGate permission="night_audit.close">` for buttons; `useHasPermission` hook for inline gates.

---

## G. File map (new + modified)

**New**
- `supabase/migrations/<ts>_night_audit_v2.sql` (sessions, decisions, permissions seed, phone↔customer trigger, backfill, cron rewrite plan note)
- `src/lib/night-audit.functions.ts`
- `src/lib/check-in-flow.ts` (the shared controller — fixes the §A gap)
- `src/routes/_authenticated/night-audit.tsx` (page shell + tabs)
- `src/routes/_authenticated/night-audit.$sessionId.tsx` (EOD report viewer)
- `src/components/night-audit/arrivals-tab.tsx`
- `src/components/night-audit/inhouse-tab.tsx`
- `src/components/night-audit/departures-tab.tsx`
- `src/components/night-audit/dues-tab.tsx`
- `src/components/night-audit/reconciliation-tab.tsx`
- `src/components/night-audit/review-close-panel.tsx`
- `src/components/night-audit/eod-report.tsx`

**Modified**
- `src/components/night-audit-dialog.tsx` → thin shortcut linking to `/night-audit`, kept for backward compat in the topbar.
- `src/routes/_authenticated/bookings_.$id.tsx`, `house-view.tsx`, `_authenticated/index.tsx` → switch their Check-In handlers to `useCheckInController`.
- `src/routes/api/public/night-audit.ts` → reminder-only, no DB mutations.
- `src/lib/night-audit-api.ts` → repointed to the new server fns; deprecate `bulkSetStatus` (now goes via decisions log).
- `src/components/app-sidebar.tsx` → add "Night Audit" page entry under Operations (badge = exceptions count).

---

## H. Deep UAT scenarios

### H.1 Check-In parity (the immediate finding)
For each of: Night Audit · Booking Page · House View · Dashboard "Today's Arrivals":
1. Booking with no phone (OTA) → phone gate appears.
2. Booking with no docs → documents dialog appears.
3. Booking with no rooms → room assignment loop appears.
4. All gates passed → status flips to Checked-In; row disappears from Arrivals; In-House tab count +1.
5. Same booking, retry from a different surface → cannot re-check-in (status already Checked-In).

### H.2 Happy-path close
3 arrivals, 2 departures, 0 dues, 0 variance → Close → BD advances → cash audit close created → EOD stored → visible in History page.

### H.3 Block-then-override close
1 unsettled departure → staff sees disabled close button → admin logs in → enters override reason → close succeeds → decision logged with reason.

### H.4 Cash variance allowed
Declared cash differs by ₹500 → reason "Guest paid next morning" → close still succeeds → variance + reason in EOD and `night_audit_sessions.cash_variance*`.

### H.5 Mid-audit walk-in & OTA arrival
Create walk-in with `check_in = BD` while NA open → appears in Arrivals immediately. Trigger `/api/public/hotelzify-poll` → new OTA booking appears in Arrivals with `OTA` badge.

### H.6 Extend stay during NA
Departing guest extended by 2 nights → row moves from Departures to In-House → decision logged.

### H.7 Reopen last closed
Owner reopens → BD rolls back → cash audit close deactivated → session in `in_progress` → no data loss in decisions → re-close succeeds.

### H.8 Reopen refusal
Try to reopen a session that is not the most recently closed → server returns error, UI shows toast.

### H.9 Permissions
Staff sees Resolve actions but not Close/Reopen/Override. Admin/Owner see everything. Verified by `<PermissionGate>` and server-side checks.

### H.10 Concurrent reception
Two browsers, same session, two staff resolve different bookings → no conflicts, two `night_audit_decisions` rows, lists refresh via realtime/`invalidateQueries`.

### H.11 Idempotent close
Double-click Close → first wins, second returns "already closed" toast; no double BD advance.

### H.12 Cron neutrality
Hit `/api/public/night-audit` at 23:59 → response says `audit_required` reminder; BD unchanged; no booking statuses changed; no `night_audit_runs` row created.

### H.13 Time zone
Close at 23:55 IST and 00:05 IST → BD math stays in `Asia/Kolkata`; advanced_to is BD+1 in IST.

### H.14 Phone↔customer invariant
- Replay the HEXB-5EDCAE scenario synthetically (mismatched phone) → trigger blocks save / auto-rewires.
- Backfill report surfaces 0 outstanding mismatches after Phase 1 runs.

### H.15 EOD numbers
Run a parallel SQL query for the same BD → totals match the EOD report exactly (Σ payments, occupancy %, ADR, RevPAR).

### H.16 PDF rendering
Open EOD HTML view → download PDF → PDF visually matches HTML, page breaks are clean, no broken fonts.

### H.17 Backward compat
Old `NightAuditDialog` entry point still works → routes the user to `/night-audit` and resumes the open session.

### H.18 Empty day
BD with zero arrivals/departures/in-house → close still works → EOD shows zero rows but valid totals.

### H.19 No double session
Attempt to open a second session for the same BD via two tabs → second call returns existing session id (idempotent).

### H.20 Data quality screen
Admin opens `/settings/data-quality` (Phase 5) → sees backfill leftovers, can resolve one-by-one.

---

## I. Phased delivery

| Phase | Deliverable | UAT gate |
|---|---|---|
| 1 | Shared `useCheckInController` + wire into Night Audit, Booking, House View, Dashboard | H.1 |
| 2 | `night_audit_sessions` + `decisions` migration, server fns, permissions seed, phone-invariant trigger + backfill | H.14 |
| 3 | New `/night-audit` page with Arrivals / In-House / Departures / Dues tabs (no close yet) | H.5, H.6 |
| 4 | Reconciliation tab + Review & Close + override + cash variance | H.2, H.3, H.4 |
| 5 | EOD report (HTML + PDF) + History deep link | H.15, H.16 |
| 6 | Reopen flow + cron neutralization | H.7, H.8, H.12 |
| 7 | Full Deep UAT pass (all H.*) + sign-off | all |

---

## J. Open items needing your nod before I start Phase 1

1. **PDF strategy** — start with browser print-to-PDF (zero deps) and upgrade to `@react-pdf/renderer` later if you want server-rendered PDFs? Default: yes, browser print first.
2. **Sidebar entry** — add "Night Audit" as a top-level item under Operations, or keep it inside the Topbar shortcut? Default: top-level under Operations.
3. **Reminder channel** — when cron detects "audit_required", send via the existing `crm_outbound_emails` queue, or just show a dashboard badge? Default: dashboard badge only (no email yet, matches your earlier "don't wire delivery" stance).

Once you confirm 1–3, I'll start with **Phase 1** (the shared Check-In controller — the immediate finding) and report back with UAT H.1 evidence before moving on.
