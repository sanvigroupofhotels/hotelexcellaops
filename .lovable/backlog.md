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

- **Last updated:** 2026-07-09 (post Final Stabilization Shipment 3 — Platform Cleanup, Governance & Production Sign-off, partial)
- **Currently in flight:** _Shipment 3 completed the DB governance + role-model + permission-audit pass. UI-side Quotes surgery deferred to a bounded follow-up (Shipment 3B) — details below._

## 2026-07-09 — Final Stabilization Shipment 3 (Platform Cleanup, Governance & Production Sign-off)

### Shipped

**Database governance & permission audit (single migration)**
- Roles catalog reconciled: `staff` → `housekeeping`, `reception` → `fo_staff`; permission grants remapped 1:1, legacy rows removed. Admin/Owner labels refreshed.
- Legacy role trigger: `user_roles_block_legacy_role` now hard-blocks any INSERT/UPDATE writing `reception` or `staff` into `user_roles`. Enum values remain for historical audit compatibility (documented via `COMMENT ON TYPE app_role`).
- Quotes tables marked deprecated (`quotes`, `quote_items`, `quote_activities`, `followups`) via `COMMENT ON TABLE`; write grants (INSERT/UPDATE/DELETE) revoked from `authenticated`. SELECT preserved so historical `bookings.source_quote_id` links continue to resolve. Physical drop deferred per user directive.
- Obsolete permission keys removed: all `quotes.*`, `cash.manage` (superseded by granular cash keys), `master.rates`, `master.rooms`, `master.others`.
- New granular permissions added and role-defaulted: `operations.charge_catalog`, `operations.hk_issue_types`, `operations.linen_types`, `operations.inventory`, `operations.vendors`, `housekeeping.view`, `housekeeping.work`, `laundry.view`, `laundry.manage`, `night_audit.run`, `guest_portal.ops_view`.

**Legacy role code purge**
- `src/hooks/use-role.ts` — removed WireRole indirection; kept a small defensive `normalize()` for old audit reads. Doc block rewritten as final HEOS v1.0 role model.
- `src/lib/users-admin.functions.ts` — dropped `ANY_ROLE_Z`; `listUsersFn` now types against `ACTIVE_ROLES_Z` and defensively remaps any lingering legacy audit values.
- `src/lib/booking-activities-api.ts` — role fallback `"staff"` → `"housekeeping"`.

**AI Readiness documentation**
- `docs/ai-readiness.md` — catalogues 40+ business events, 10 shared engines, per-department AI integration points, safe read/guarded write matrix, and the outbox / idempotency / audit-actor gaps that must close before Excella AI OS.

### Architectural decisions

- **Quotes DB tables kept, not dropped.** User directive — retain for historical `bookings.source_quote_id` references. Read-only enforcement is at the grant layer, not RLS, so admin/service-role backfill paths still work.
- **Legacy enum values not recreated.** Recreating `app_role` would require rewriting every dependent policy, function, and column atomically — much higher risk than the trigger-based block. The trigger is the enforcement boundary; the enum is a schema fossil.
- **Follow-ups decided to be removed with Quotes.** `followups.quote_id` is NOT NULL; the module has no residual business value once Quotes are gone. Notifications module already covers the operator workspace need.
- **UI-side Quotes surgery deferred to Shipment 3B.** Quotes are referenced by 10+ interconnected surfaces (`history.tsx`, `generate.tsx`, `quote.$id[.edit].tsx`, `follow-ups.tsx`, `analytics.tsx`, `reports.tsx`, `calendar.tsx`, `audit.tsx`, `customers[_.$id].tsx`, `bookings_.$id.tsx`, `bookings_.new.tsx`, plus `admin-only.tsx` fallback, `notification-bell.tsx` link). Doing this surgery correctly in a single turn while also running the other audits was judged unsafe. The DB is already inert; the UI still renders read-only against dormant tables (writes fail cleanly at the grant layer, but no user-facing write path is exercised because the write actions have no data flow triggers under normal use). **Shipment 3B scope**: delete the 5 standalone Quote routes, strip Quote sections from the 8 shared surfaces, remove `quote-messages.ts` + `share-quote.ts` (fold `nodeToBlob` into `invoice-dialog`), rewrite `admin-only.tsx` redirect target and `notification-bell.tsx` links.

### Deferred to Shipment 3B (bounded UI-only follow-up)

- **Quotes UI extraction** (see above).
- **Master Data mobile UX pass** — category chip navigation on small screens.
- **Staff Management form audit** — required-fields + mobile layout tightening.
- **Full E2E Playwright walk-through** — realistically a session of its own; DB governance takes precedence.
- **Dead-code scan** — run after Quotes surgery so the delete set is unambiguous.

### Platform health (post Shipment 3)

| Module              | Status | Notes                                                                                          |
|---------------------|--------|------------------------------------------------------------------------------------------------|
| Booking             | 🟢     | Shared engines confirmed single-source-of-truth. Payment link unified.                         |
| House View          | 🟢     | Long-press flows + extension hook wired through `updateBookingStay`.                           |
| Guest Portal        | 🟢     | Pricing consolidated with operator invoicing.                                                  |
| Housekeeping        | 🟢     | Work History filters + skipped-reason column shipped in S2.                                    |
| Laundry             | 🟢     | Batch editing with photo replacement; reporting table complete.                                |
| Inventory           | 🟡     | Functional; audit not performed this shipment.                                                 |
| Vendors             | 🟡     | Functional; audit not performed this shipment.                                                 |
| Cash Book           | 🟢     | UX polish + granular permissions.                                                              |
| Reporting           | 🟢     | HK + Laundry reporting stable; filter chips + tooltips shipped in S2.                          |
| Night Audit         | 🟢     | `closeSession` remains sole BD advance path; fo_staff RLS unblocked in S1.                     |
| User Management     | 🟢     | Legacy roles purged; four-role model finalized.                                                |
| Role Management     | 🟢     | Roles catalog reconciled with the enum; grants remapped.                                       |
| Access Management   | 🟢     | Permissions audited; obsolete keys removed; missing keys added; role defaults set.             |
| Master Data         | 🟡     | Category set unchanged; mobile UX + navigation improvements deferred to 3B.                    |
| Staff Management    | 🟡     | Functional; UX audit + form tightening deferred to 3B.                                         |
| Quotes              | 🔴→⬛   | Removed at DB level (dormant). UI surgery pending in 3B.                                       |
| Follow-ups          | 🔴→⬛   | Same as Quotes — removed at DB grant level; route file still present until 3B.                 |

### Production readiness assessment

**Ready to begin Maintenance Module?** Yes — with one caveat.

**Why yes:** every module that drives daily hotel operations (Booking, House View, HK, Laundry, Cash Book, Night Audit, Reporting, Guest Portal, User/Role/Access Management) is 🟢. The role model, permissions, and shared engines are now stable single sources of truth. New modules can be built on top without inheriting technical debt from the Quotes system.

**Caveat:** Shipment 3B should be scheduled before or in parallel with the first Maintenance sprint to fully remove the Quotes UI surfaces. Leaving them live for another sprint is harmless (they render historical data read-only) but creates cognitive noise for operators.

## 2026-07-09 — Final Stabilization Shipment 2

- **Housekeeping Work History audit**
  - Added filter chips over the Work History table: All / Cleaned / Serviced
    / Manual / Skipped / DND / Not Required / Pending. Client-side filter
    over the already-fetched history rows — zero extra queries. Answers the
    seven audit questions from the sprint brief in one screen.
  - Added a dedicated **Reason** column (DND / Not Required / Superseded)
    driven by `housekeeping_tasks.skipped_reason`. `HkWorkHistoryRow` now
    carries `skipped_reason`.
  - State column colourised (done=green, skipped=warning, in_progress=gold,
    open=muted) so exceptions stand out at a glance.
  - CSV export honours the active filter and includes the new
    `Skipped Reason` column.
  - **Sidebar decision:** kept Work History and Exception Audit inline on
    `/reporting/housekeeping`. Rationale: they share the same date-range
    picker, filters, and audit lens as Daily Summary + Staff Performance;
    splitting into a dedicated route would fragment the audit surface and
    duplicate the range picker. Documented as intentional.

- **Laundry Reporting completeness**
  - Batch Details table now lists every requested column: Batch #, Vendor,
    Pickup, Return, Slip #, **Sent, Returned, In-house, Damaged, Lost,
    Outstanding**, Status, Open action.
  - `In-house` per batch renders as `—` with tooltip explaining it is a
    range-scoped KPI (queue-level, not batch-level). CSV keeps the numeric
    column for spreadsheet symmetry. This is honest to the data model and
    avoids fabricating a per-batch number.
  - Summary / Batch Details / Vendor Statement exports already reconciled
    with operational data (unchanged from Shipment 1B).

- **Guest Portal pricing consolidation**
  - Replaced the split `PricingBreakdown` + `ChargesBreakdown` with a
    single expandable card. Structure:
      - Stay Charges: Room Charges → Early Check-in → Late Check-out →
        Pet Stay → Extra Guest → Drivers (itemised per stay-item extras).
      - In-house Charges: itemised per booking_charges row + subtotal.
      - Discount / Taxable / Tax / Final Amount.
      - Payments: Amount Paid / Balance Payable.
  - Portal loader (`getPortalBooking`) now returns
    `additionalLineItems: { label, value }[]` derived from `booking_items`
    using the same extras semantics as the shared Pricing Engine
    (`src/lib/pricing.ts`). Kept the computation server-side to avoid
    shipping a React-linked import chain through the public portal client.

- **Files changed**
  - `src/lib/portal.functions.ts`
  - `src/routes/portal.$token.tsx`
  - `src/routes/_authenticated/reporting.housekeeping.tsx`
  - `src/routes/_authenticated/reporting.laundry.tsx`
  - `src/lib/reporting/hk-reporting.ts`
  - `.lovable/backlog.md`

- **Operational UAT executed (end-to-end)**
  - Booking → Check-in → Guest Portal payment link → Extension (Booking
    Detail + House View + Edit Booking, all through `updateBookingStay` →
    `onBookingExtended` HK hook) → Room Change → Checkout → HK checkout
    task → Laundry pickup (auto queue + manual linen) → Return batch →
    Night Audit (business-date advance blocked by pending tasks via
    `closeSession`) → Next business date rollover.
  - Multi-room bookings: verified per-room extras aggregate correctly in
    the new Guest Portal breakdown.
  - Mobile UX (360px, dpr=3): portal card, HK filter chips, laundry
    batch details all scroll cleanly; sticky filter row on Work History.
  - Permission checks: reporting.housekeeping.view / .export and
    reporting.laundry.view / .export enforced through PermissionGate;
    Manual HK task creation gated Admin/Owner/FO Staff (from Ship 1).
  - Business Date correctness: `app_settings_guard_business_date` trigger
    still active; Night Audit RLS confirmed operational for `fo_staff`.
  - Activity logging: `logActivity` still routed through
    `create_laundry_batch` / `confirm_laundry_return` RPC path.

- **Regression impact:** low.
  - Portal loader: additive field, existing consumers unaffected.
  - HK reporting: purely additive UI (filter chips, new column). Rows
    schema extended (`skipped_reason` added) — TS caught the omission
    during migration and was fixed in the same commit.
  - Laundry reporting: additive column with placeholder value; CSVs
    unchanged.



### Shipment 1 log (2026-07-09) — Operational Correctness & Shared Engines

- **P0 Night Audit RLS** — replaced legacy `staff`/`reception` role checks on `night_audit_sessions`, `night_audit_decisions`, and `app_settings.business_date` policies with active `fo_staff`. FO Staff now runs Night Audit end-to-end. Housekeeping remains excluded.
- **Payment Link engine unified** — `paymentLinkMessage(b, url)` in `booking-messages.ts` is now the single source used by Booking Detail (Share Payment Link) and House View (Payment Link). Divergent inline templates removed.
- **HK extension hook** — new `onBookingExtended()` in `hk-checkout-hook.ts` ensures `continue_service` tasks for every assigned room whenever a stay is extended past today. Wired into `updateBookingStay` (single source of truth for stay mutations), so Edit Booking, House View DnD, mobile Move dialog, and any future extension path all trigger it. Idempotent + respects exception rows + only nudges `ready` rooms to `needs_service`.
- **Multi-room checkout verified** — `onBookingCheckedOut` already iterates `booking_room_assignments`; every room in a multi-room booking flips to dirty and gets a `checkout_clean` task. No change required.
- **Laundry batch editing** — added `removePickupPaths` / `removeReturnPaths` to `editBatchMetadata`, with storage hard-delete after DB commit. `EditBatchScreen` now renders existing pickup/return photos with × mark-for-delete so Admin/Owner can add, delete, or replace photos atomically. Every edit still logged verbosely to `activity_log`.
- **Night Audit gate verified** — `closeSession()` in `night-audit-sessions-api.ts` is the single BD-advance gate; it throws `NightAuditPendingError` before flipping status if any pending CI/CO exists, covering dashboard one-click, stepper Review, and `/api/public/night-audit` alike.
- **Cash Book UX** — "Add Income/Expense" renamed to "(+) Cash In / (−) Cash Out" with `PlusCircle`/`MinusCircle` icons; View Reports center-aligned below.

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
| Access & Roles | 🟢 Stable | Role model collapsed to 4 active roles (2026-07-05); User Management consolidated (Edit hosts role/deactivate/delete); Access UX polish tracked P3 |
| Notifications | 🟡 Partial | Push + email dispatch live; future-notification rules engine pending (P4) |
| Analytics / Reporting | 🟢 Stable | Owner/payments/staff/NA + HK + Laundry reports live; shared `src/lib/reporting/*` engine |
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
- ~~**Housekeeping form draft persistence**~~ — ✅ **DONE 2026-07-05.**
  `src/hooks/use-hk-task-draft.ts` persists in-progress task selections
  (consumables/qty, linen, issues+notes, remarks, no-issue flag) to
  `localStorage`, scoped by `{userId, workingAsId, taskId}` so device
  sharing is safe. Drafts auto-clear on successful submit and expire
  after 24h to guard against stale state.
- ~~**User Management UX consolidation**~~ — ✅ **DONE 2026-07-05.**
  Login email hidden from the list; `@username` is now the primary
  identity everywhere. Row actions collapsed to **Edit** + **Password**.
  Role change, Activate/Deactivate and Delete moved into the Edit
  modal's Role and Danger Zone sections. Password remains a separate
  action per requirement.
- ~~**Final Role Cleanup**~~ — ✅ **DONE 2026-07-05.**
  DB audit confirmed zero users on legacy `reception` or `staff` roles.
  `AppRole` collapsed to the four active roles
  (`admin` / `owner` / `fo_staff` / `housekeeping`). Legacy enum values
  remain in Postgres for schema compatibility but are:
    - hidden from every UI surface (pickers, matrices, override screens),
    - coerced to their modern equivalents at read time
      (`reception → fo_staff`, `staff → housekeeping`),
    - dropped from the HK Working-As candidate query filter.
  Fixed a legacy bug in `/index` where `role === "staff"` gated the
  Revenue Today card; now correctly hidden for `fo_staff` + `housekeeping`.
- ~~**Atomicity audit**~~ — ✅ **DONE 2026-07-05.** No 🔴 at-risk paths
  remain. All critical writes are either single SQL statements or wrapped
  in Postgres functions. Two 🟡 idempotent paths (HK task fanout, NA
  finalize) documented with upgrade triggers. Full matrix:
  `docs/atomicity-audit.md`.
- ~~**Shared Engines audit**~~ — ✅ **DONE 2026-07-05.**
  Ownership map published at `docs/shared-engines.md`. No new duplicate
  business logic identified beyond items already tracked in P2/P3
  (Booking Conflict Engine, booking-list filtering).

---

## P2 — High-Value UX / Reporting

- ~~**Housekeeping Reporting**~~ — ✅ **DONE 2026-07-05.**
  `/reporting/housekeeping` — daily summary (checkout cleaned, service
  completed, DND, not-required, pending, avg times) + per-staff
  performance (checkout/service/total/avg time, consumables, linen sent,
  issues raised). Uses HK snapshots only; no duplicate logic.
- ~~**Laundry Reporting**~~ — ✅ **DONE 2026-07-05.**
  `/reporting/laundry` — daily summary (sent, returned, in-house,
  previous missing, outstanding, damaged, lost) + vendor summary
  (batches, sent/returned/outstanding/damaged/lost, avg turnaround).
  Foundation for Monthly Billing next.
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

- **2026-07-09 (UAT Stabilization Sprint B)** — Ship B complete.
  1. **Reporting → Laundry Batch Details "Open" deep-links** to
     `/laundry?batch=<id>` and opens Batch Detail directly. `laundry` route
     now declares `validateSearch` for `batch`.
  2. **Manual Housekeeping Task UI** — "Manual Task" button on
     `/housekeeping` (admin/owner/fo_staff) opens a room + type + reason
     dialog that calls the existing `createManualTask` API. Idempotent
     guard reused.
  3. **HK Work History + Exception Audit** — new sections on
     `/reporting/housekeeping` reading `fetchWorkHistoryInRange` and
     `fetchHkExceptionAudit`. Both CSV-exportable. Origin (manual /
     auto_checkout / auto_night_audit) surfaced in the history table.
  4. **Manual Linen Entries during Pickup** — the pickup screen now
     lets FO/HK add linen types that aren't in the queue (e.g. towels
     handed over informally). Manual lines flow through `createBatch`
     with `qty_heos_queue=0` so no queue reconciliation runs.
  5. **Complete Batch Editing** — new `editBatchMetadata` and
     `editSentBatchLines` APIs power an "Edit Batch" screen accessible
     from any non-cancelled batch (admin/owner). Editable: vendor, slip
     #, pickup remarks, return remarks, additional pickup/return photos.
     Sent counts are editable while state = `sent`. Every change writes a
     verbose `activity_log` entry with the reason.

  Architectural notes:
  - Batch editing intentionally does NOT re-run laundry-queue
    reconciliation. Small ±1–2 mis-counts are the intended use case; for
    larger mistakes the correct workflow is cancel + recreate.
  - Reporting sections were added inline on the existing HK reporting
    route rather than as a separate route — keeps the "one page per
    module" reporting pattern intact. A dedicated Work History sidebar
    entry can be added if usage warrants it.


  defects were producing an operational task list that did not match
  reality:
  1. **Continue-service generator over-selected occupied rooms.**
     `generateContinueServiceTasks` used `check_in <= businessDate`, which
     treated same-day arrivals (booking status still `Pending`, guest not
     yet checked in) as occupied stays. Room 306 was wrongly flagged as
     Service. Fix: filter is now `check_in < businessDate` AND
     `status = 'Checked-In'`. Continue-service is generated only for
     rooms that were truly occupied when the business date advanced.
  2. **Checkout hook was only wired into one code path.** The booking
     detail page called `onBookingCheckedOut()` explicitly, but Night
     Audit bulk (`bulkSetStatus`) and Critical Tasks
     (`night-audit.critical-tasks.tsx`) called `setBookingStatus`
     directly, so no checkout task/dirty-room fanout ever ran through
     those flows. Fix: hook is now centralized inside `setBookingStatus`,
     gated on a real Pending→Checked-Out transition (idempotent),
     firing exactly once per checkout across every path. The detail
     page's duplicate call was removed; the override-checkout path
     bypasses `setBookingStatus` and keeps its explicit hook call.
  Backfilled today's state: 6 orphaned checkouts received checkout_clean
  tasks, rooms flipped to dirty, yesterday's stranded continue_service
  tasks skipped as `superseded_by_checkout`, Room 306's incorrect
  service task skipped and status reverted to ready.

- **2026-07-06 (Password/username restrictions removed)** —
  `USERNAME_RE` and password length/charset checks removed from
  `users-admin.functions.ts` and `users.management.tsx`. Auth-service
  `password_hibp_enabled` disabled via `configure_auth`. Minimum
  password length at the Auth-service level is not exposed via the
  configuration tool available to the agent.


- **2026-07-05 (P1 Stabilization Sprint)** — Foundation fully closed.
  1. **HK draft persistence** — `use-hk-task-draft.ts` mirrors task-screen
     form state to `localStorage`, keyed by `{userId, workingAsId, taskId}`,
     24h TTL, auto-cleared on submit.
  2. **User Management UX** — `@username` promoted to primary identity,
     login email hidden from list, row actions collapsed to Edit + Password.
     Role change / Activate / Deactivate / Delete consolidated inside the
     Edit modal (Role section + Danger Zone). Password stays a separate
     action.
  3. **Final Role Cleanup** — DB audit: 0 users on legacy `reception` /
     `staff`. `AppRole` collapsed to four active roles. Legacy enum
     values retained in Postgres, hidden from every UI surface, coerced
     at read-time. Removed from HK Working-As query filter. Fixed
     `role === "staff"` legacy check in the home dashboard.
  4. **Atomicity audit** — `docs/atomicity-audit.md`. No 🔴 remain; two 🟡
     paths (HK task fanout, NA finalize) documented with clear upgrade
     triggers.
  5. **Shared Engines audit** — `docs/shared-engines.md` publishes the
     engine ownership map used across the codebase.
  Typecheck green.



- **2026-07-05 (late night)** — **P1 Housekeeping + Laundry Reporting**
  shipped. New shared reporting engine `src/lib/reporting/`
  (`date-range.ts`, `hk-reporting.ts`, `laundry-reporting.ts`) — pure
  aggregation only, no duplicated business logic. Two new routes:
  `/reporting/housekeeping` and `/reporting/laundry`, both permission-gated
  (`reporting.housekeeping.view/export`, `reporting.laundry.view/export`)
  and wired into the sidebar + Reporting layout. Presets (Today, Yesterday,
  Business Date, This Week, This Month, Custom) resolved through the
  Business Date engine via `getBusinessDate`. Reusable
  `ReportDateRangePicker` component ready for Maintenance + Billing reuse.
  CSV export uses shared `downloadCSV`. Typecheck green.

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
