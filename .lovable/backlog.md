# HEOS — Project Backlog

Single source of truth for pending work. Merged from all prior sprint completion
reports and design discussions. Completed items have been removed. This file
MUST be updated at the end of every sprint (add new items, promote/demote
priorities, remove shipped items).

- **Last updated:** 2026-07-05 (post Laundry Ship 2)
- **Currently in flight:** _None._ Laundry send + return path shipped.

Priority ladder:

| Level | Meaning |
|-------|---------|
| P0 | Correctness / data-integrity / security. Ship before next feature sprint. |
| P1 | Operational blockers. Frontline staff feel the pain daily. |
| P2 | High-value UX / reporting that owners and managers ask for. |
| P3 | Medium — polish that materially improves usability. |
| P4 | Nice-to-have — deferred until an appropriate module lands. |
| P5 | Long-horizon / dependent on future modules. |
| P6 | Ideas parking lot. May never ship. |

---

## In Flight (not backlog)

_None._

---

## Laundry — Deferred to Follow-up Sprint

- **P2 — Monthly Billing / Reconciliation screen** — schema (batches +
  lines) already carries queue / sent / in-house / OK / short / damaged /
  lost per linen type; needs vendor-scoped month view, per-linen rate
  card, invoice reconciliation, and export. No schema change required.
- **P3 — Vendor screen `is_laundry` filter chip** — `vendor_kind` array
  is populated; add the chip on the Vendors screen.
- **P3 — Batch activity feed on Batch Detail** — reuse the shared
  activity-log reader keyed by `entity_type='laundry_batch'`.
- **P4 — Damaged linen → auto-complaint toggle** — silent in v1 per
  approved design; add an app-setting toggle later.
- **P4 — Cancel window guard** — currently open-ended; consider
  restricting cancel to same `business_date`.


---

## P0 — Correctness / Security

_None open._ (Attribution audit, RLS + GRANT audit, Razorpay modernization,
and Housekeeping race conditions were closed in the preceding sprints.)

---

## P1 — Operational Blockers

- **Housekeeping form draft persistence** — persist the in-progress task
  screen selections (consumables / linen / issues / remarks) to
  `sessionStorage` keyed by `task_id`, so a hard refresh or accidental
  back-tap does not wipe a housekeeper's entries mid-task. Task state
  itself is already safe; only the local form is at risk.
- **User Management UX consolidation** — hide login email column by
  default, group users by role, surface `@username` as the primary
  identifier. Deferred from the Roles & Username Login sprint.

---

## P2 — High-Value UX / Reporting

- **Phase 3A.6 — Housekeeping Reporting** — daily rooms cleaned by staff,
  average completion time per task type, consumables consumed, linen
  totals, DND/Not-Required counts. Should sit under `/reporting` next to
  Payments and Owner Dashboard, reusing the existing reporting shell.
  Best delivered alongside Laundry Reporting so KPIs land together.
- **Phase 2C — Maintenance Module** — room-maintenance work orders,
  Out-of-Service state ownership, vendor + cost tracking. Design was
  scoped in Phase 2 architecture; implementation still pending.
- **Master Data consolidation screen** — one Admin screen that hosts
  Complaint Categories, Linen Types, HK Issue Types, Expense Categories,
  Inventory Categories, Charge Catalog references. Today these are
  scattered under Operations. Navigation/usability only — no business
  logic changes.

---

## P3 — Polish

- **Bulk "Mark DND for tonight"** — multi-select rooms on the
  Housekeeping page and mark them DND / Service Not Required in one
  action. Current single-tap flow is fine for 23 rooms but this saves
  time on quiet evenings.
- **Housekeeping — sticky "Working As" pill in the task list header**
  visible while scrolling long lists (already pinned in the task screen).
- **User Management** — search by username, filter by role chip.
- **Activity Log dashboard filters** — quick chips for `hk_*` and
  `laundry_*` actions once Laundry ships.

---

## P4 — Deferred (module-dependent)

- **Laundry ↔ Inventory linen master reconciliation** — when Laundry
  ships, verify linen counts flow back into stock-on-hand for towels /
  sheets that are treated as inventory items rather than pure linen.
  Design decision needed at Laundry kickoff.
- **Complaint auto-close from Housekeeping re-visit** — if the same
  issue type is reported again on a room within N days, escalate
  priority. Requires complaint-history read path.

---

## P5 — Long-horizon

- **Guest-facing housekeeping preferences** — DND flag / green-stay
  option from the guest portal, feeding `housekeeping_room_exceptions`.
  Depends on portal auth already in place; low volume for a 23-room
  property.
- **Push notifications for housekeeping** — assign a task to a specific
  housekeeper and notify their device. Requires per-user push
  subscriptions already partially wired.

---

## P6 — Parking Lot

- Photo attachments on Housekeeping issues (before → complaint).
- Voice-note remarks on tasks.
- Multi-property support (currently single-property HEOS).

---

## Won't Do (kept here so we don't re-propose)

- **4-state HK overlay on House View** — product decision (2026-07-05):
  FO Staff will continue to access Housekeeping from its own sidebar
  entry; House View stays booking-focused.
- **Separate Housekeeping "Issue" system** — all HK issues MUST create
  a Complaint via the shared engine. Enforced in `filePotentialComplaints`.

---

## Change Log

- **2026-07-05** — File created. Merged pending items from Sprint A
  (Razorpay + attribution), Sprint B (attribution audit), Phase 3A
  (Housekeeping design → implementation → stabilization), and Phase 2
  (Operations foundation). Removed completed items. Marked House View
  HK overlay as Won't Do.
