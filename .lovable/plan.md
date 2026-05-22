# Hotel Excella OS — Production Build Plan

This is a very large scope. To ship it reliably without half-built modules, I'll execute it in 4 sequential phases, each ending in a working, deployable state. Phases run in the same project — no separate branches.

## Phase 1 — Data model, pricing engine & UI primitives

**Migrations**
- `customers` table with all fields (reference code, contact, company/GST, preferences, lifecycle counters, tags[], status, booking_probability, next_action, next_followup_date, payment_status, lost_reason, internal_notes). RLS: select for authenticated, insert/update/delete own.
- `quotes` additions: `customer_id` (fk), `adults`, `guests`, `pet_size` (enum: none/small/medium/large), `payment_status`, `booking_probability`, `lost_reason`. Keep `extra_bed` column but rename in UI to "Extra Adults".
- `tasks` table: title, type, priority, due_date, status, customer_id, quote_id, assignee_id, notes. RLS + realtime.
- Trigger `link_or_create_customer()` on quote insert: match by phone/email, else create; bump counters on status changes.
- Add `customers`, `tasks` to `supabase_realtime` publication with `REPLICA IDENTITY FULL`.

**Pricing engine (`src/lib/quotes-api.ts`)**
- Room tariffs table in code: Oak Queen (₹2500/₹2250), Mapple King (₹3000/₹2750) based on breakfast.
- Extra Adult ₹500, Extra Breakfast ₹150 (only when breakfast excluded), Driver ₹500.
- Pet: small ₹500 / medium ₹750 / large ₹1000 (omit line if none).
- Early check-in: 10–13 ₹500, 8–10 ₹750, 6–8 ₹1000, <6 full-day.
- Late checkout: ≤14 ₹500, 14–16 ₹1000, >16 full-day.
- Standard timings 1 PM in / 11 AM out shown everywhere.

**UI primitives**
- Fix `Switch` (and `Toggle`) tokens: off-state visible gray border + thumb, on-state gold. Applied globally via `src/styles.css` + component update.
- New tokens for hot/warm/cold lead, probability pill, payment status pill.

## Phase 2 — Customers CRM + Tasks + Calendar

- `/customers` list: search, filter (status/tag/lead source/payment), sort, pagination, tag chips, status & probability badges, CSV export (UTF-8 BOM, Excel-safe), realtime.
- `/customers/$id` profile: details, insights (totals, conversion %, AOV, last stay, preferred room), tags editor, next-action + probability editor, internal notes, timeline merged from `quote_activities` + followups + tasks + payment events, returning-guest badge.
- Auto-link existing quote create/edit flows to customers (via trigger); show "Returning Guest" inline on Generate.
- `/tasks` board: Today, Upcoming, Overdue tabs; create/edit/complete; priority + due date; quote/customer links; realtime.
- `/calendar` upgrade: day/week/month views, check-ins, check-outs, follow-ups, tasks, tentative bookings, occupancy bar per day; mobile-friendly.

## Phase 3 — Analytics + Quote enhancements + WhatsApp logging

- `/analytics`: KPI cards (conversion, pipeline value weighted by probability, AOV, repeat %), charts for lead source performance, revenue forecast (sum of total × probability for Pending/Negotiating), funnel, lead aging, follow-up efficiency, best room.
- Quote history: CSV export, filters for lead source / payment status / date range, advanced search.
- Generate/Edit quote: adults + guests separate inputs, pet size selector, lost-reason field on Lost status, payment status, booking probability, next action.
- WhatsApp share already produces image — add activity-log entries for every send type (quote_image / reminder / followup / revised / payment_reminder / booking_confirmation).
- Internal notes hidden from PDF / image / WhatsApp / CSV customer exports.

## Phase 4 — Polish, mobile, sidebar, QA

- Sidebar: add Customers, Tasks, Analytics; reorder.
- Mobile passes on every new page (sticky action bars, large tap targets).
- Verify all CRUD round-trips, realtime invalidation hooks on every list.
- Remove all placeholder copy / dead buttons.

## Technical details

- Stack stays TanStack Start + Supabase via existing `quotes-api.ts` pattern; new `customers-api.ts`, `tasks-api.ts`.
- Realtime via existing `useRealtimeInvalidate` hook, extended to new tables.
- CSV via small util `src/lib/csv.ts` with BOM + RFC4180 escaping; download via Blob URL.
- No edge functions; all logic in client + Postgres triggers.
- Charts: lightweight `recharts` (already a shadcn dep via `chart.tsx`).

## Out of scope (will flag, not build)

- Multi-user role/permission system beyond existing auth (single staff role).
- Inventory/room-block management beyond a calendar visual indicator.
- Real payment gateway integration (status tracking only).

After you approve, I'll execute Phase 1 first (migration + pricing engine + toggle fix), then move straight into Phase 2–4 in subsequent turns without pausing.
