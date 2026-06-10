## Goal
Close every outstanding UAT item from prior sprints in one careful pass. Backing schemas are NOT changed for Rooms / Rates / Staff / Expense Types / Complaint Categories — only the UI is unified under Master Data. Lead Sources & Tags continue to live in `master_data`.

## 1. Bookings / Quotes — Extras click bug (P1)
**Symptom:** Early Check-In, Late Check-Out, Pet Stay, Extra Adults, Drivers cannot be toggled in New/Edit Booking and New/Edit Quote.

**Investigation:** read `src/components/line-items-editor.tsx` and `src/components/shared/stay-form-sections.tsx` to find the broken handler (likely a stale `onChange` writing to the wrong index after the recent line-items refactor, or a `disabled` flag from a missing field on new items).

**Fix:** restore per-line state updates so each toggle/select mutates only its own item, and confirm extras flow into `computePricing()` → `pricing-breakdown.tsx`.

**Verify:** add an extra → see line subtotal change → see "Additional Charges" line appear in the breakdown → save → reopen → values persist on both Booking and Quote.

## 2. Editable Total + Taxes Included checkbox
**Behavior:**
- New "Taxes Included" checkbox next to Tax Rate.
  - Unchecked (current default): `Total = Subtotal + Taxes`.
  - Checked: the entered Total is treated as tax-inclusive; back-compute `Subtotal = round(Total / (1 + taxRate))`, `Taxes = Total − Subtotal`.
- "Total Amount" becomes editable. Editing it sets an override; breakdown shows "Adjustment" = `Total − (Items − Discount + Taxes)` so the math always reconciles.
- Clearing the override returns to the computed value.

**Touch points:** `src/lib/pricing.ts` (add `taxInclusive` + `totalOverride` to `computePricing`), `src/components/pricing-breakdown.tsx`, both Booking and Quote forms, and persistence (add `taxes_included` boolean and `total_override` numeric on `bookings` + `quotes`).

## 3. Room Assignment rules
In `src/components/room-assignment-field.tsx` + `src/lib/rooms-api.ts`:
- **Occupied for the selected dates** → hidden from the dropdown (already partly in `listOccupiedRoomIds`; ensure both staff & admin see no occupied rooms).
- **Blocked (room_maintenance)** → hidden from the dropdown.
- **Future-assigned to another booking starting after this one's check-out** → shown but with an inline warning "Assigned to BKG-1234 from <date>"; saving is allowed only if no overlap with current dates (which is already enforced by the DB trigger).
- Dropdown re-queries when check-in/check-out change.

## 4. Rates & Inventory — Bulk Apply
In `src/lib/rates-api.ts` and `src/routes/_authenticated/rates.tsx`:
- **Date offset bug:** `bulkApplyOverrides` iterates with `new Date(from)` which parses as UTC, so in IST `toISOString().slice(0,10)` shifts to the previous day. Switch to a string-based date walker (`addDays(YYYY-MM-DD, 1)`) so 6 → 8 yields exactly `[06, 07, 08]`.
- **Single room type:** change the multi-select to a single Select; remove the array; rename param to `room_type: string`.
- Mobile: stack the form vertically, replace the multi-column override grid with a swipeable card list on `<sm`.

## 5. Master Data hub UI (no schema churn)
Restructure `src/routes/_authenticated/master-data.tsx` into tabs:
- **Lead Sources** (existing — `master_data` table)
- **Tags** (existing — `master_data` table)
- **Rooms** (reuses `rooms-api.ts`, embed the existing Rooms management UI from `/rooms`)
- **Rates & Inventory** (link-out to `/rates`, or embed read-only summary)
- **Staff** (reuses `staff` table via a new tiny `staff-api.ts`)
- **Expense Types** (reuses `expense_types` table)
- **Complaint Categories** (reuses `complaint_categories` table)

Sidebar: keep deep links to `/rooms` and `/rates` for power users; mark `/master-data` as the canonical entry.

**Dropdown wiring audit:**
- CashBook Staff dropdown → reads from `staff` table (already does).
- CashBook Expense Types → switch to `expense_types` table.
- Complaint Categories dropdown → switch to `complaint_categories` table.
- Lead Source & Tag dropdowns → already wired to `master_data`.

**Mobile UX:** tab list collapses to a Select on `<sm`; each tab's table becomes a card list; primary CTA pinned to a sticky bottom bar.

## 6. Guest Portal P1 (already shipped this turn)
Share link now uses the stable public origin (`project--<id>.lovable.app`) instead of the auth-gated preview URL. Tokens and validation were already correct — no schema change needed.

## 7. Verification checklist (run before declaring done)
1. Create booking → toggle every extra → breakdown updates live.
2. Edit booking → extras persist, totals match, override + tax-inclusive math reconciles.
3. Same for Quote create/edit.
4. Room dropdown for an overlapping date hides occupied/blocked rooms.
5. Bulk Apply 6→8 with one room writes exactly 3 rows.
6. Master Data hub renders all 7 tabs without console errors on mobile + desktop.
7. CashBook expense-type dropdown reads from Master Data.
8. Complaint category dropdown reads from Master Data.
9. Generate share link → opens portal on published URL.

## Technical notes
- Migration adds `taxes_included boolean default false` and `total_override numeric` to `bookings` and `quotes` (nullable, backfills as null). No data backfill needed.
- No FK changes; rooms/rates/staff stay in their own tables.
- All new dropdowns use the existing `useMasterData()` hook pattern, extended with a `useTableMasterData(table)` helper for `expense_types` / `complaint_categories` so the consumer API is uniform.
- Realtime listeners on `master_data`, `expense_types`, `complaint_categories` so dropdowns stay live without a refresh.

## Out of scope (will not touch)
- Razorpay webhook signature / order logic (already shipped).
- Auth flows, role grants, RLS policies on existing tables.
- Any visual redesign of pages not listed above.
