# Operational Maturity Rollout

The scope you listed (CSV fixes, multi-room, drafts, rate protection, roles, audit log, sticky summary, status workflow expansion, keyboard nav, prefill from customer, etc.) is roughly 3–4 weeks of focused work across ~40 files and 6+ schema migrations. Shipping it all in a single turn would guarantee regressions in flows you already rely on (Generate, Edit, WhatsApp, CSV).

I'll execute it in 4 focused turns. Each turn is self-contained, testable, and leaves the app in a working state. Tell me to proceed and I'll start Turn 1 immediately. You can also reorder.

## Turn 1 — CRITICAL fixes + customer→quote prefill (ship first)
Files: ~6, 1 migration
- **Fix CSV exports** (customers + quotes): verify `downloadCSV` on Android Chrome / desktop, add a `target=_blank` fallback path, surface error toasts properly. Add quotes CSV columns: Quote ID, Guest, Phone, Room, Stay, Guests, Taxes, Total, Status, Created By, Created Date. Add customers CSV: Name, Phone, Email, Quotes, Created, Last Interaction, Lead Source.
- **Customer detail → Create Quote**: add prominent "Create Quote" button on `customers.$id.tsx` that navigates to `/generate?customerId=<id>` and prefills guest name, phone, email, preferred room, lead source.
- **Customers table**: already compact; add the "Create Quote" quick action (➕) icon next to call / WhatsApp / view.
- **Status workflow expansion**: extend `quote_status` enum with `Draft`, `Sent`, `Negotiating`, `Cancelled`, `Expired`, `Advance Paid`, `Full Amount Paid`, `Checked In`. Update `statusStyles` map, status pill, status dropdowns, filters. Migration adds enum values.

## Turn 2 — Edit Quote stability + Drafts + Duplicate + Internal Notes
Files: ~5
- **Edit Quote audit**: walk every field on `quote.$id.edit.tsx` against the schema, fix any field that doesn't load/save (occupancy, breakfast, extras, payment status, lost reason, etc.). Preserve `reference_code`, `created_at`, `customer_id` on save.
- **Save Draft / Resume Draft**: drafts are just quotes with status `Draft`. Add explicit "Save as Draft" button on Generate; History gets a Drafts filter; Draft rows get "Resume" CTA → opens edit page.
- **Duplicate Quote**: button on quote detail → creates new quote, resets status to `Draft`, new reference code, copies all fields, keeps `customer_id`.
- **Internal notes timeline**: append-only notes log surfaced in quote detail + customer detail; never included in WhatsApp / image / PDF / CSV (audit existing exports).

## Turn 3 — Multi-room + Rate Protection + Sticky Live Summary + Keyboard nav
Files: ~6, 1 migration
- **Multi-room schema**: new `quote_rooms` table (quote_id, room_type, occupancy, extra_adults, breakfast_included, rate, line_total). Existing single-room quotes back-fill as one row. Totals recompute from rooms.
- **Multi-room UI**: Generate + Edit get "Add Room" with per-room sub-card; each room independently configurable; final summary aggregates.
- **Rate protection**: minimums per room type; if staff drops below, warn + require override reason (stored on the quote as `rate_override_reason`). Migration adds the column.
- **Sticky live summary**: floating bottom card on mobile + sticky right rail on desktop showing room charges, breakfast, extras, taxes, discount, final total — visible across Generate and Edit.
- **Keyboard nav**: Enter → focus next field, optimized tab order, numeric inputs use `inputMode="decimal"`.

## Turn 4 — Roles + Audit Log + Advanced Search
Files: ~5, 1 migration
- **Roles**: `app_role` enum (admin / manager / front_desk) + `user_roles` table + `has_role()` security-definer function (per project user-roles rules). UI gates: pricing overrides (manager+), delete quote (manager+), reports/analytics (manager+). Front Desk can only quote.
- **Audit log**: `audit_log` table (actor, action, entity_type, entity_id, before/after JSON, timestamp). Hook into quote create/update/delete, status change, rate override, customer delete. Surface as timeline on customer + quote detail.
- **Advanced search**: history page gets multi-filter bar — guest, phone, quote id, room type, status, created_by, date range, lead source. URL-synced for shareable filters.

## Notes
- Each turn ends with a verification pass (build + spot-check the changed flows in the preview).
- No new features added beyond what's listed — purely closing your brief.
- After Turn 4 the app meets every requirement in this message.

**Reply "go" (or "start with turn N") and I'll begin.**