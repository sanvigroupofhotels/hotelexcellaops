# PMS Stabilization Sprint

Guest Portal / Razorpay is parked. This sprint focuses purely on PMS items, sequenced so each slice is shippable and testable before the next begins.

## Slice 1 — Pricing & Booking/Quote UX (highest impact, blocks daily ops)

**Schema (single migration):**
- `ALTER TABLE bookings ADD COLUMN taxes_included boolean NOT NULL DEFAULT false, ADD COLUMN total_override numeric NULL;`
- `ALTER TABLE quotes ADD COLUMN taxes_included boolean NOT NULL DEFAULT false, ADD COLUMN total_override numeric NULL;`

**Pricing engine (`src/lib/pricing.ts`):**
- Accept optional `{ totalOverride, taxesIncluded }`.
- When `totalOverride` set + `taxesIncluded=false` → taxes = round(override × rate / (1+rate)) reverse-calc; total stays at override.
- When `totalOverride` set + `taxesIncluded=true` → taxes = round((override × rate) / 1), total = override + taxes (treat override as net) — confirm with user; default = override is gross.
- Add `overrideApplied: boolean` to `PricingBreakdown`.

**UI:**
- `src/components/pricing-breakdown.tsx`: editable Total field (admin/manager only via `useUserRole`), "Taxes Included" toggle, "Override" badge when active, "Reset to computed" link.
- Wire into New Booking, Edit Booking, New Quote, Edit Quote save handlers; persist `total_override` + `taxes_included`.
- Audit `line-items-editor.tsx` extras toggles — confirm each toggle (early CI, late CO, pet, extra adults, drivers) mutates only its own row's state, not shared.

## Slice 2 — Master Data hub completion + Rates/House polish

**Master Data tabs (`master-data.tsx`):**
- Add Rooms tab: deep-link to `/rooms` (already exists) + inline list (read-only summary).
- Rates tab: deep-link to `/rates` + show current `room_rates` rows inline (read-only).
- Staff tab: pulls from `staff` table — inline CRUD via existing cash API helpers, gated to admin.
- Expense Types tab: inline CRUD against `expense_types` table.
- Complaint Categories tab: inline CRUD against `complaint_categories` table.
- Keep existing lookup categories (lead_source, tag, payment_method, income_category, complaint_status).

**Rates & Inventory (`rates.tsx`):**
- Verify Bulk Apply 11→14 produces 11,12,13,14 (already fixed string-arithmetic; add inclusive-day count chip "X days will be updated").
- Single room-type select for Bulk Apply (no multi-room confusion).
- Mobile: stack controls vertically <640px, sticky Apply button.

**House View (`house-view.tsx`):**
- Date column separation (Check-in / Check-out as two columns, not one).
- Breakfast indicator badge per booking row.
- House Overview stats card (rooms occupied / available / arrivals / departures today).
- Room-assignment conflict guard: when picking a room for assignment, hide rooms with overlapping confirmed bookings + show toast if conflict.

## Slice 3 — CashBook role split + reports

**CashBook (`cash.tsx`):**
- Staff view: gate Owner/Paid-To-Owner columns behind `useUserRole` === admin.
- Admin reports panel: monthly totals, paid-to-owner totals, CSV export (already have `csv.ts`), PDF export via existing invoice-dialog print pattern.
- Activities log unchanged.

## Out of scope (parked)
- Guest Portal / Razorpay (lowest priority per user)
- Global Payment Settings table (defer until Portal returns)
- New auth flows, visual redesigns

## Execution order
1. Slice 1 migration → engine → UI wiring → smoke test on Bookings + Quotes.
2. Slice 2 Master Data tabs → Rates polish → House View polish.
3. Slice 3 CashBook role split + reports.

I'll ship Slice 1 in the next turn, report back with UAT scenarios, then move to Slice 2.

## Technical details
- Migration uses ALTER TABLE only — no FK/trigger changes, dropdowns unchanged.
- All UI changes preserve existing component signatures; only additive props.
- `useUserRole` already exists at `src/hooks/use-role.ts` — reused everywhere.
- Realtime invalidation via existing `useRealtimeInvalidate` for new master tables.
