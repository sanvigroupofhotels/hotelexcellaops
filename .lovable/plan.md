# HEOS v1.0 — Shipment 3: Platform Cleanup, Governance & Production Sign-off

This shipment is destructive by design (removes legacy roles, quotes, obsolete permissions, dead code). Before I execute, I want you to confirm scope — especially around **Quotes removal** and the **DB cleanup boundary** — since those are hardest to reverse.

## Execution phases (internal, single completion report)

### Phase A — Legacy Role Removal (`reception`, `staff`)

- **Codebase**: purge all UI/label/select references. `useUserRole` already coalesces, but I'll remove the coalescing branches now that the DB audit confirmed zero users. `ANY_ROLE_Z` in `users-admin.functions.ts` collapses to `ACTIVE_ROLES_Z`.
- **RLS**: audit every policy referencing `has_role(_, 'reception'|'staff')` and rewrite to `fo_staff`/`housekeeping` in a single migration.
- **DB enum**: I will NOT drop the enum values (Postgres cannot drop enum values without a full recreate, and any historical audit_log row still referencing them would break). Instead: add a comment on the enum documenting them as deprecated + a CHECK/trigger blocking new inserts of legacy values on `user_roles`. Documented as intentional deviation.
- **Docs**: update comments in `use-role.ts`, `.lovable/backlog.md`.

### Phase B — Quotes Removal

Before I delete: quotes touch `quotes`, `quote_items`, `quote_activities`, `share-quote.ts`, `quote-messages.ts`, `quote-items-api.ts`, `quotes-api.ts`, `routes/_authenticated/quote.$id.tsx`, `quote.$id_.edit.tsx`, `generate.tsx`, `follow-ups.tsx`, and permissions `quotes.*`.

- **Plan**: remove all routes, components, APIs, sidebar entries, permissions rows. Keep DB tables intact (data preservation) but revoke `authenticated` grants so they become dormant. `follow-ups` — verify whether follow-ups depend on quotes; if yes, migrate to booking-only follow-ups.
- **Confirm**: OK to fully remove `/quote/*` routes and the "Generate Quote" screen, and to keep the historical `quotes` tables read-only in DB?

### Phase C — Access & Role Management Audit

- Reconcile `permissions` table against actual guards in routes/components. Produce a diff:
  - **Add** any missing keys for: House View actions, Guest Portal ops view, HK Reporting filters, Laundry batch edit, Cash Book reports, Night Audit history, Master Data CRUD, Inventory movements, Vendors CRUD, User Management actions.
  - **Remove** obsolete: `quotes.*`, any `reception.*`/`staff.*`, duplicates.
- Regroup by module in `permissions.sort_order` so the Role Matrix reads top-to-bottom per module.
- Verify sidebar (`app-sidebar.tsx`) visibility gates match the permission keys.

### Phase D — Master Data audit

- Enumerate categories (`lead_source`, `tag`, and any others in DB). Confirm usage; remove unused categories.
- Improve mobile UX on `/master-data` (compact list, category chips instead of tabs on small screens). Non-architectural.

### Phase E — Staff Management audit

- Verify no duplicate data between `staff`, `profiles`, `user_roles`. Confirm Working As reads `staff` (not a duplicate map).
- Tighten forms — required fields, mobile layout.

### Phase F — Shared Engine / Dead Code audit

- Grep for unimported files, unused hooks, unreferenced routes. Delete only clearly-dead files (no external references).
- Consolidate any remaining duplicated helpers I find.

### Phase G — Production Readiness matrix + E2E self-UAT

- Walk the full lifecycle in `browser-use` Playwright (headless) with the injected Supabase session. Booking → Check-in → Portal → Extension → Room Change → Checkout → HK → Laundry → Reporting → Cash → Night Audit → BD advance.
- Produce 🟢/🟡/🔴 table per module in the completion report.

### Phase H — AI Readiness doc (docs only)

- New file `docs/ai-readiness.md`: event catalog (BookingCreated, GuestCheckedIn, HKTaskGenerated, LaundryReturned, InventoryLow, NightAuditCompleted, BusinessDateAdvanced, PaymentReceived, ComplaintFiled, …), shared engines directory, recommended AI integration points.

## Deliverables

- Single migration file for RLS/permissions/grants cleanup.
- Bulk file deletions for Quotes + legacy dead code.
- Updated `app-sidebar.tsx`, `use-role.ts`, `users-admin.functions.ts`, role matrix UI.
- `docs/ai-readiness.md`.
- Updated `.lovable/backlog.md` with Platform Health + honest v1.0 sign-off assessment.

## Decisions I need from you

1. **Quotes**: fully remove UI/routes/APIs, keep DB tables dormant (revoke grants) — OK? Or hard-drop tables?
2. **Legacy enum values (`reception`, `staff`)**: keep in `app_role` enum with deprecation comment + insert-block trigger (safe) — OK? Or attempt full enum recreate (risky, requires rewriting all dependent policies/columns in one migration)?
3. **Follow-ups**: if `followups` depends on quotes, do you want follow-ups to remain (booking-only) or be removed too?

Once you confirm 1–3, I'll execute Phases A–H in a single internal pass and return one consolidated completion report.

&nbsp;

My comments for the plan you proposed - 

---

I approve the overall execution plan and the sequencing. Please execute Phases A–H as a single internally sequenced shipment and return one consolidated completion report.

Below are my decisions and a few additional expectations.

### 1. Quotes

**Decision:**

- ✅ Remove all Quote functionality from the application.
- ✅ Remove all Quote routes.
- ✅ Remove all Quote UI.
- ✅ Remove all Quote APIs.
- ✅ Remove Quote permissions.
- ✅ Remove Quote navigation.
- ✅ Remove Quote business logic.
- ✅ Remove any dead components/hooks/utilities created exclusively for Quotes.

For the database:

- **Do NOT drop Quote tables yet.**
- Keep them dormant/read-only for now.
- Revoke application access where appropriate.
- Document them as deprecated.
- We can physically remove them in a future database cleanup after sufficient production confidence.

If Follow-ups currently depend on Quotes, migrate them to a booking-centric implementation. If Follow-ups have no remaining business value after Quotes removal, remove them as well. Please make the architectural decision and document it.

---

### 2. Legacy Roles

**Decision:**

Do **NOT** recreate the PostgreSQL enum.

I agree with your recommendation.

- Keep the legacy enum values only for database compatibility.
- Block all future inserts/updates using those values.
- Remove every reference from the application.
- Remove every reference from permissions.
- Remove every reference from UI.
- Remove every reference from documentation.
- Treat them as permanently deprecated.

The application should operate entirely on the four supported roles only:

- Owner
- Admin
- FO Staff
- Housekeeping

---

### 3. Access & Role Management

Please don't just reconcile permissions.

Please perform a genuine audit.

For every permission ask:

- Is it still needed?
- Is it duplicated?
- Is it actually enforced?
- Is anything missing?
- Can anything be simplified?

The goal is a clean, maintainable permission model.

---

### 4. Master Data

Please don't only review existing masters.

Also challenge the current design.

For every master determine:

- Is it still required?
- Is it duplicated?
- Can it be merged?
- Can navigation improve?
- Can mobile UX improve?

Don't hesitate to simplify where appropriate.

---

### 5. Staff Management

Same expectation.

Treat this as a complete UX and architecture audit rather than only fixing forms.

---

### 6. Shared Engine Audit

Please also verify:

- No duplicate pricing logic.
- No duplicate room status logic.
- No duplicate booking status logic.
- No duplicate housekeeping logic.
- No duplicate laundry logic.
- No duplicate payment link generation.
- No duplicate notification/message generation.
- No duplicate reporting calculations.

If duplicates are discovered, consolidate them wherever safe.

---

### 7. End-to-End UAT

Please perform this as if HEOS were operating Hotel Excella today.

Don't only verify reported issues.

Think through realistic hotel operations.

Test:

- Happy paths
- Negative paths
- Interrupted workflows
- Concurrent users
- Mobile
- Desktop
- Multi-room bookings
- Business Date transitions
- Permission boundaries
- Reporting reconciliation
- Cross-module consistency

If you discover issues aligned with the existing architecture, please fix them proactively and document everything.

---

### 8. Production Readiness

For every major module, classify:

🟢 Production Ready

🟡 Minor Improvements Remaining

🔴 Blocking Issues

Please be completely honest.

If anything is not production ready, explain:

- Why
- Remaining effort
- Whether it blocks the Maintenance Module

---

### 9. AI Readiness

I like the proposed `docs/ai-readiness.md`.

Please think beyond events.

Also document:

- Shared engines suitable for AI consumption.
- Future Automation Engine trigger points.
- Approval workflow candidates.
- Executive dashboard data sources.
- Department AI opportunities (Operations, Finance, Inventory, Marketing, CRM, Revenue, etc.).

This is documentation only.

---

### 10. Additional Request

As part of this shipment, please perform one final "architect's review" of HEOS.

Imagine you were inheriting this codebase for the first time.

If you find anything that feels inconsistent, unnecessarily complex, duplicated, technically risky, or no longer aligned with the current architecture, please improve it where safe and document those decisions in the completion report.

The goal of this shipment is not only to complete the backlog, but to confidently declare **HEOS Core v1.0** as the production foundation before we begin the Maintenance Module and, eventually, the Excella AI OS journey.

---

&nbsp;