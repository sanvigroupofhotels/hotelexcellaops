# HEOS — Project Backlog

Single source of truth for pending work on HEOS. Reconciled 2026-07-05
after **P1 Housekeeping + Laundry Reporting** sprint.

**Governance rules (per user directive, 2026-07-05):**

- This file is the authoritative roadmap. Every new feature/UX/architecture
  request MUST be checked against it, added if missing, deduplicated,
  and prioritized.
- Every sprint completion report MUST update this file: remove shipped
  items, promote/demote priorities, log architectural decisions.
- Architectural initiatives are kept separate from functional features.
- Won't Do items are kept explicit so rejected ideas are not re-proposed.
- Every completion report includes a **Reconciliation Summary**.
- The **Platform Health** section below is refreshed every sprint.

- **Last updated:** 2026-07-05 (post HK + Laundry Reporting)
- **Currently in flight:** _None._

---

## Platform Health — Module & Engine Status

Legend: 🟢 Stable · 🟡 Partial · 🔵 In Progress · ⚪ Planned · ⛔ Not Started

| Module / Engine | Status | Notes |
|-----------------|--------|-------|
| Booking (Detailed + Quick) | 🟢 Stable | Quick↔Detailed pricing parity closed 2026-07-05 |
| Pricing Engine | 🟢 Stable | `computePricing` shared by Quotes, Bookings (Detailed + Quick), Invoices, WhatsApp, Portal |
| Rates & Inventory | 🟢 Stable | Override → weekend/weekday → default; single resolver |
| Customer / CRM | 🟢 Stable | Shared resolution hooks; leads pipeline live |
| Payments (Cash + Razorpay) | 🟢 Stable | Cash Book auto-entries; Razorpay webhook verified |
| Housekeeping | 🟢 Stable | Task lifecycle, DND, exceptions, checkout hook, laundry enqueue |
| Laundry | 🟢 Stable | Ship 1 + Ship 2 + transactional RPCs complete |
| Vendor | 🟢 Stable | `vendor_kind[]` tagging; laundry-scoped |
| Complaints | 🟢 Stable | Categories, activities, HK integration |
| Inventory | 🟢 Stable | Movements, categories, charge catalog |
| Night Audit | 🟢 Stable | Sessions, decisions, EOD report, critical tasks |
| Activity Log | 🟢 Stable | Universal audit trail; used by every module |
| Access & Roles | 🟡 Partial | Role migration done; Access UX polish pending (P3) |
| Notifications | 🟡 Partial | Push + email dispatch live; future-notification rules engine pending (P4) |
| Analytics / Reporting | 🟡 Partial | Owner/payments/staff/NA reports live; HK + Laundry reports pending (P2) |
| Maintenance | ⚪ Planned | Table `room_maintenance` exists; UI + workflow pending (P2) |
| Booking Conflict Engine | ⚪ Planned | Piecemeal checks exist; unified surface pending (P2) |
| Operational Rules Engine | ⚪ Planned | Internal principle; consolidate when Maintenance adds 5th rule (P2 arch) |
| Guest Portal | 🟢 Stable | Documents, payments, profile completion live |
| Booking Engine (public) | 🟢 Stable | Multi-step search → checkout → review → confirmation |
| Master Data | 🟡 Partial | Data live; Masters rename + consolidation pending (P2) |
| Documentation | ⛔ Not Started | Manuals + engine map + rules matrix pending (P3–P4) |

---

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

## Reconciliation Report (2026-07-05)

Assessment of every roadmap item you supplied, with status legend:
✅ done · 🟡 in backlog · 🔴 missing · ⚪ won't do · 💡 re-prioritize.

### 1. Functional Features

| # | Item | Status | Evidence | Confidence | Engine Owner |
|---|------|--------|----------|------------|--------------|
| P1.1 | Laundry Queue UI | ✅ | `src/routes/_authenticated/laundry.tsx` (Queue tab) | High | Laundry |
| P1.2 | Laundry Batch | ✅ | `laundry_batches`, `laundry_batch_lines`, `laundry-batches-api.ts` | High | Laundry |
| P1.3 | Send to Laundry | ✅ | `create_laundry_batch` RPC (atomic) | High | Laundry |
| P1.4 | Return Laundry | ✅ | `confirm_laundry_return` RPC (atomic) | High | Laundry |
| P1.5 | Lost / Damaged Linen | ✅ | Return path handles short/damaged/lost with roll-forward | High | Laundry |
| P1.6 | Vendor Integration | ✅ | `vendors.vendor_kind text[]`, batch → vendor FK | High | Vendor |
| P1.7 | Activity Log integration | ✅ | `laundry_batch_sent/returned/cancelled/in_house_recorded` | High | Activity |
| P1.8 | Reporting Hooks | 🟡 P2 | Data model already carries queue/sent/OK/short/damaged/lost | High | Analytics |
| P1.9 | Housekeeping Reporting (rooms cleaned/serviced, productivity, duration, linen, consumables, daily summary) | 🟡 P2 | Data exists in `housekeeping_tasks` snapshots; report UI pending | High | Analytics |
| P1.10 | Quick Booking Pricing Parity (override total, override diff, discount, reuse detailed engine) | 🔴 → **added P1** | `bookings_.quick.tsx` vs `bookings_.new.tsx` currently diverge on override semantics | Med | Pricing |
| P2.1 | Booking Conflict Engine (dirty room, room not ready, double allocation, arrival conflicts, blocked room, HK-not-complete warnings) | 🔴 → **added P2** | Partial checks exist in `room-availability.ts` and `blocks-api.ts`; no unified conflict surface at assign time | High | Booking |
| P3.1 | User Management UX (hide auth email, `@username` primary, edit/password on cards, group by role, permission search, simplify cards) | 🟡 P1 (existing) + expanded | `users.management.tsx`, prior sprint left email column visible | High | None (Access) |
| P3.2 | Role Management — fixed system roles (Admin, Owner, FO Staff, Housekeeping) | ✅ | Migration 20260705020812 collapsed roles to `admin/owner/fo_staff/housekeeping` | High | Access |
| P3.3 | Access Management (group by role, permission search, UX) | 🔴 → **added P3** | `users.access.tsx` exists but no grouping/search polish | High | Access |
| P4.1 | Masters — rename "Master Data" → "Masters", consolidate operational masters | 🟡 P2 (Master Data consolidation) | `operations.*` split; sidebar label change pending | High | None |
| P5.1 | Maintenance Module (reuse Complaint + Vendor + Activity + HK + Photos) | 🟡 P2 (existing) | `room_maintenance` table exists; UI + workflow pending | High | Complaint + Vendor |
| P6.1 | Notification Engine — future notifications only, reuse Activity Log | 🔴 → **added P4** | `notifications-api.ts`, `notification-engine.ts`, and push wiring exist; no rules-driven future-notification layer | Med | Notification |
| P7.* | Manuals (Admin/Owner/FO/HK/Laundry/Inventory/Night Audit SOP/User Mgmt) | 🔴 → **added P4 (Documentation)** | No `docs/manuals/` tree exists yet | High | None |
| P8.* | Additional Reports (Laundry, Inventory, Vendors, HK, Complaints, Room Perf, Staff Productivity) | 🔴 → **added P3–P4** | Underlying data exists; report shells pending | High | Analytics |
| P9.* | Application-wide UX Refinement | 🟡 P3 (partial) | Scattered UX items; consolidated below | Med | None |
| P10.* | Future Automation (scheduled reports, low-stock alerts, laundry/HK/vendor reminders) | 🔴 → **added P5** | Depends on Notification Engine + Operational Rules Engine | High | Notification |
| P11.* | Performance & Technical Debt | 🟡 partial | Called out below | Med | None |

### 2. Architectural Improvements (added / confirmed)

- **Operational Rules Engine (internal)** — 🔴 → **added as P2 architectural**.
  Today the "rules" (checkout → dirty, night audit → needs_service, HK
  complete → laundry queue, checkout charges → inventory movements,
  payment → booking balance) are scattered across hooks (`hk-checkout-hook.ts`,
  `perform-night-audit.ts`, `booking-charges-api.ts`, `enqueueLinen`).
  **Recommendation:** keep them scattered *for now* but formalize the
  contract in `docs/operational-rules.md` (event → effect table) and add a
  P2 backlog item to consolidate them into one `src/lib/operational-rules/`
  registry when the 5th rule (Complaint → Notification, from Maintenance)
  is added. Building the registry before we need the 5th rule is
  over-engineering for a 23-room property. **Verdict: internal
  architectural principle now, backlog item when Maintenance ships.**
- **Transactional server-side writes** — ✅ closed for Laundry
  (`create_laundry_batch` / `confirm_laundry_return`). Recommend the same
  pattern for future multi-step writes (Maintenance dispatch, Billing
  reconcile).
- **Shared Engines audit** — 🔴 → **added P3**. Publish a one-pager
  cataloguing owned domains: Booking, Pricing, Inventory, Customer,
  Payment, Notification, Activity, Analytics, Access, Vendor, Complaint,
  Housekeeping, Laundry. Prevents future duplicate business logic.

### 3. Technical Debt

- **P1** — Client-side multi-statement writes elsewhere (cancelBatch,
  HK task completion, cash close) should be surveyed for the same
  atomicity gap Laundry just closed. Add: `docs/atomicity-audit.md`.
- **P3** — Duplicate booking-list filtering logic between
  `bookings.tsx` and `calendar.tsx`. Consolidate into `booking-status.ts`.
- **P3** — `mock-data.ts` still referenced from a handful of screens.
- **P4** — Router `routeTree.gen.ts` is stable; no action.

### 4. Documentation

- **P4** — Ops manuals per role (see P7.* above).
- **P3** — `docs/operational-rules.md` (event → effect matrix).
- **P3** — `docs/shared-engines.md` (engine ownership map).
- **P4** — Night Audit SOP.

### 5. Future Enhancements

- **P5** — Scheduled reports (weekly HK / laundry / cash to owner email).
- **P5** — Low-stock alerts (Inventory).
- **P5** — Laundry / HK / Vendor reminders.
- **P6** — Multi-property (currently 23-room single property).

### Duplicates & Overlaps Found

- "User Management UX" appeared in prior P1 and roadmap P3 — merged into
  single **P1 User Management UX consolidation** entry.
- "Permission search" appeared in both User and Access management — kept
  as one item under Access UX.
- "Housekeeping Reporting" and "Additional Reports → Housekeeping" — merged.
- No orphan duplicates found in the previous backlog file.

### Recommended Priority Re-ordering (vs your P1–P11 list)

Your ordering is largely correct. My proposed refinements:

1. **Keep P1 = Laundry** — done. ✅
2. **Promote Quick Booking Pricing Parity to P1** — you listed it under
   P1; agreed. It's a correctness gap (guest quote vs internal price
   diverge). Should ship before HK Reporting.
3. **Booking Conflict Engine (your P2) — split**: the "dirty room" and
   "HK-not-complete" warnings can ship as part of the Quick Booking
   pricing parity sprint since both touch the assign-room path.
   Standalone conflict engine can stay P2.
4. **Move Documentation (your P7) up to P4** — writing manuals before
   Maintenance and Notification lands captures the current stable state;
   waiting until P7 risks stale documentation from a moving target.
5. **Maintenance (your P5) stays P2** in this backlog — it unlocks the
   Operational Rules Engine consolidation and closes a real operational
   gap (Out-of-Service ownership).
6. **Notification Engine (your P6) → P4** — depends on Maintenance
   shipping first so Complaint → Notification rule has a real consumer.
7. **UX Refinement (your P9) → distribute across P3** rather than one
   giant sprint. Bundle UX polish with each module it touches.

Suggested execution order for the next sprints:

```text
Sprint N+1 : P1 — Quick Booking Pricing Parity + assign-time HK warnings
Sprint N+2 : P2 — Housekeeping + Laundry Reporting (Analytics engine)
Sprint N+3 : P2 — Maintenance Module (unlocks Rules Engine consolidation)
Sprint N+4 : P2 — Booking Conflict Engine (standalone surface)
Sprint N+5 : P3 — Access & User Management UX + Masters rename/consolidation
Sprint N+6 : P4 — Notification Engine (future-only, rules-driven) + Documentation
Sprint N+7+: P5 — Automation, alerts, scheduled reports
```

---

## In Flight (not backlog)

_None._

---

## P0 — Correctness / Security

_None open._ Laundry transactional atomicity closed 2026-07-05.

---

## P1 — Operational Blockers

- ~~**Quick Booking Pricing Parity**~~ — ✅ **DONE 2026-07-05.**
  Quick Booking now reuses the shared editable `PricingBreakdownCard`,
  `computePricing`, per-booking `PaymentSettingsSection`, and Master-Data
  lead sources. Override + Taxes-Included behave identically to Detailed.
  Field-by-field audit: `docs/booking-parity.md`.
- **Housekeeping form draft persistence** — persist in-progress task
  screen selections (consumables/linen/issues/remarks) to
  `sessionStorage` keyed by `task_id`. Task state itself is safe; only
  the local form is at risk on refresh.
- **User Management UX consolidation** — hide login email by default,
  group users by role, surface `@username` as primary identifier, edit +
  password actions on card, move role/deactivate/delete inside Edit.
  *Engine:* Access.
- **Atomicity audit** — survey remaining multi-statement client writes
  (cancelBatch, HK task complete, cash close, night audit finalize) and
  either wrap in a Postgres function or document why the current shape
  is safe. Deliverable: `docs/atomicity-audit.md`.

---

## P2 — High-Value UX / Reporting

- **Housekeeping Reporting** — daily rooms cleaned by staff, avg
  completion time per task type, consumables consumed, linen totals,
  DND / Not-Required counts. Under `/reporting`, reuse existing shell.
  Ship alongside Laundry Reporting so KPIs land together. *Engine:*
  Analytics.
- **Laundry Reporting** — daily/weekly/monthly sent, returned, in-house,
  short, damaged, lost per linen type and per vendor. Feeds Monthly
  Billing next. *Engine:* Analytics.
- **Laundry Monthly Billing / Reconciliation screen** — vendor-scoped
  month view, per-linen rate card, invoice reconciliation, export. No
  schema change required (batch lines carry everything).
- **Maintenance Module** — room-maintenance work orders,
  Out-of-Service ownership, vendor + cost tracking, HK integration,
  photos. Reuses Complaint + Vendor + Activity + HK engines.
- **Booking Conflict Engine** — unified operational validations at
  assign time: dirty room, room not ready, double allocation, arrival
  conflict, blocked room, HK-not-complete. *Engine:* Booking.
- **Master Data consolidation** — one Admin screen hosting Complaint
  Categories, Linen Types, HK Issue Types, Expense Categories, Inventory
  Categories, Charge Catalog. Rename sidebar entry to **Masters**.
- **[Architectural] Operational Rules Engine — evaluation** — decide
  whether to consolidate scattered rules (checkout → dirty, NA → needs
  service, HK complete → laundry queue, charges → inventory, payment →
  balance) into `src/lib/operational-rules/` registry when Maintenance
  ships (adds the 5th rule).

---

## P3 — Polish

- **Bulk "Mark DND for tonight"** — multi-select rooms on Housekeeping
  and mark DND / Service Not Required in one action.
- **Housekeeping sticky "Working As" pill** in list header while scrolling.
- **User Management** — search by username, filter by role chip.
- **Access Management UX** — group by role, permission search, simpler cards.
- **Activity Log dashboard filters** — quick chips for `hk_*` /
  `laundry_*` action families.
- **Vendor screen `is_laundry` filter chip** — `vendor_kind` array
  already populated by Laundry migration; add the chip.
- **Batch activity feed on Batch Detail** — reuse the shared activity-log
  reader keyed by `entity_type='laundry_batch'`.
- **Additional Reports (light)** — Complaints trend, Room Performance,
  Staff Productivity. Reuse Analytics engine.
- **[Docs] `docs/operational-rules.md`** — event → effect matrix.
- **[Docs] `docs/shared-engines.md`** — engine ownership map.
- **[Tech debt]** — consolidate booking-list filtering between
  `bookings.tsx` and `calendar.tsx` into `booking-status.ts`.
- **[Tech debt]** — remove remaining `mock-data.ts` usage.

---

## P4 — Deferred (module-dependent)

- **Notification Engine** — future notifications only; reuse Activity
  Log as event source. Depends on Maintenance shipping so there's a real
  Complaint → Notification consumer beyond bookings.
- **Operational Manuals** — Admin, Owner, FO Staff, Housekeeping,
  Laundry, Inventory, Night Audit SOP, User Management Guide. Under
  `docs/manuals/`. Write after Maintenance so the manuals cover the
  full ops surface.
- **Additional Reports (heavy)** — Vendors performance, Inventory
  consumption trend.
- **Laundry ↔ Inventory linen master reconciliation** — verify counts
  flow back for items treated as inventory (towels/sheets) rather than
  pure linen. Decision needed at reporting sprint.
- **Complaint auto-close from HK re-visit** — if the same issue type is
  reported again within N days, escalate priority.
- **Damaged linen → auto-complaint toggle** — app-setting flag
  (silent in Laundry v1 per approved design).
- **Cancel-batch window guard** — restrict Laundry batch cancel to same
  `business_date`.

---

## P5 — Long-horizon

- **Scheduled reports** — weekly HK / Laundry / cash email to owner.
  Depends on Notification Engine.
- **Low-stock alerts** — Inventory reorder point breach → notification.
- **Laundry / HK / Vendor reminders** — e.g. "Batch out for 4 days".
- **Guest-facing housekeeping preferences** — DND / green-stay from
  guest portal into `housekeeping_room_exceptions`.
- **Push notifications for housekeeping** — per-user push subscriptions
  already partially wired.

---

## P6 — Parking Lot

- Photo attachments on Housekeeping issues (before → complaint).
- Voice-note remarks on tasks.
- Multi-property support (currently single-property HEOS).

---

## Won't Do (kept here so we don't re-propose)

Confirmed 2026-07-05 against the roadmap. All items below remain
**Won't Do** unless the user explicitly re-opens them.

- **Purchase Orders** — 23-room property, direct vendor billing is
  simpler than PO workflow.
- **GRN (Goods Received Note)** — same reasoning; direct inventory
  receive suffices.
- **Warehouse Management** — no separate warehouse; storerooms live on
  the property.
- **Laundry Login** — Laundry is an internal operational module; vendor
  never logs in.
- **Maintenance Login** — Maintenance is internal; vendors don't log in.
- **Room Assignment to Housekeeping Staff** — 23-room property; all
  rooms visible to all housekeepers is faster than dispatching.
- **Linen Inventory Tracking (per-piece)** — Laundry queue + linen
  masters are the source of truth; per-piece inventory would duplicate
  Laundry ledger.
- **Separate Housekeeping "Issue" system** — all HK issues MUST create
  a Complaint via the shared engine.
- **House View Housekeeping Overlay** — product decision 2026-07-05.
  FO Staff access HK from its own sidebar entry.
- **4-state HK overlay on House View** — as above.

---

## Change Log

- **2026-07-05 (night)** — **P1 Quick Booking Pricing Parity** shipped.
  Quick Booking refactored to reuse editable `PricingBreakdownCard`
  (`totalOverride: number|null`, user-toggleable `taxesIncluded`),
  `PaymentSettingsSection` (per-booking flag overrides), and Master-Data
  lead sources. Guest-facing `notes` and `internal_notes` wired through
  both create and edit paths. Added Platform Health section to backlog.
  Audit doc: `docs/booking-parity.md`. Typecheck green.

- **2026-07-05 (evening)** — Full roadmap reconciliation. Added Quick
  Booking Pricing Parity (P1), Booking Conflict Engine (P2),
  Laundry/HK Reporting (P2), Maintenance (P2), Notification Engine (P4),
  Operational Manuals (P4), Automation items (P5), Operational Rules
  Engine as architectural evaluation (P2), Atomicity audit (P1),
  Shared-engines & rules docs (P3). Confirmed Won't Do section against
  roadmap. Removed nothing (previous items still valid).
- **2026-07-05 (afternoon)** — Laundry stabilization sprint: moved
  `createBatch` and `confirmReturn` into transactional Postgres RPCs
  (`create_laundry_batch`, `confirm_laundry_return`). Removed
  "wrap Laundry writes in server-side transactions" from the follow-up
  list.
- **2026-07-05 (Laundry Ship 2)** — Return path shipped; Ship 2 items
  cleared.
- **2026-07-05** — File created. Merged pending items from Sprint A
  (Razorpay + attribution), Sprint B (attribution audit), Phase 3A
  (Housekeeping), and Phase 2 (Operations foundation).
