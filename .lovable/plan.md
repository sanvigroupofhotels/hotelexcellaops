# Architecture Cleanup & FabHotels Integration

Big refactor — confirming the scope and approach before I touch code so we don't churn.

## Target Navigation (final)

```
Dashboard · Bookings · House View · Customers · Cashbook · Reporting · Staff Management · Complaints · Master Data · Settings
```

Removed from sidebar: Rooms, Rates & Inventory, Staff, Attendance, Salary, Audit, Payment Reports, Analytics (all reachable via parent modules below).

## 1. Cashbook
- Remove the in-page master tabs (Payment Modes, Expense Types, etc.) — they already exist in `master_data`.
- Keep just two tabs: **Dashboard** and **Audit Close** (admin only).
- Any master UI that's nicer than the Master Data version gets ported into Master Data, not duplicated.

## 2 & 3. Staff Management
- New top-level route `/staff-management` with tabs: **Staff Master**, **Attendance**, **Salary** (existing pages, rehoused as tabs).
- Single `staff` table remains the only source. Add columns:
  - `available_in_cashbook boolean default true`
  - `available_in_dues boolean default true`
  - `available_in_complaints boolean default true`
- All staff dropdowns app-wide filter by the relevant flag.
- Staff Master is NOT under Master Data.

## 4 & 5. Rooms & Rates under Master Data
- Move existing Rooms page and Rates & Inventory page under Master Data tabs.
- Remove standalone nav entries.

## 6. Master Data layout
Sectioned tabs:
- **General → Rooms**: Room Master, Room Categories, Room Statuses, Block Reasons
- **Finance**: Payment Modes, Taxes, Charge Categories, Expense Categories
- **Operations**: Cancellation Reasons, Override Reasons
- **Complaints**: Issue Types, Priorities, Complaint Statuses
- **Rates & Inventory** (embedded existing page)

Backed by `master_data.category` values seeded for any new categories that don't exist.

## 7. Reporting reorg
Single `/reporting` route with tabs in order:
1. **Analytics** (current Analytics page)
2. **Payment Reporting** (current payments-reports)
3. **Staff Reporting** (current Reporting page)

Old standalone routes redirect to the tabbed view.

## 8. Audit removed
Delete `/audit` route, sidebar entry, and `audit.tsx`. No data migration needed.

## 9. FabHotels email integration
- Add `fabhotels` as a first-class provider in the polling route — reuses the same configurable `field_labels`, `subject_filters`, `sender_email`, `inbox_email` UI already built for Hotelzify.
- **Sender/inbox emails come from the UI config only** — no hardcoded defaults in the backend.
- New FabHotels parser tuned for the attached email format:
  - Booking ID: from subject `Booking ID: KPZYPT` (regex on subject) + body fallback
  - Table-style fields: `NAME OF GUEST`, `CHECKIN DATE`, `CHECKOUT DATE`, `TYPE OF ROOM`, `NUMBER OF ROOMS`, `TOTAL GUESTS`, `PAYMENT MODE`, `INCLUSIONS`, `SPECIAL REQUEST`, `TOTAL BOOKING AMOUNT`
  - Date format: `15 JUN 26` → normalized
  - Lead source defaults to "FabHotels" (configurable in UI)
- Rename `/api/public/hotelzify-poll` → `/api/public/integrations-poll` that loops over all `connected` email integrations and dispatches to the right parser by `provider`. Keep old URL as alias for safety.
- Diagnostics UI on integration detail page works for both providers (already provider-agnostic, just needs the provider check broadened).

## Technical notes

- DB migrations:
  1. Add `available_in_cashbook`, `available_in_dues`, `available_in_complaints` to `staff`.
  2. Seed any missing `master_data` categories: `room_category`, `room_status`, `block_reason`, `cancellation_reason`, `override_reason`, `issue_type`, `complaint_priority`, `complaint_status`, `charge_category`. (Payment modes & expense types already have dedicated tables — keep those as-is, surface via Master Data UI.)
- Route changes (TanStack file routes):
  - New: `_authenticated/staff-management.tsx` (+ tab children or in-page tabs)
  - New: `_authenticated/reporting.tsx` becomes tabs container (current file is Staff Reporting — rename internals)
  - Delete: `_authenticated/audit.tsx`, `_authenticated/rooms.tsx` (move content), `_authenticated/rates.tsx` (move content), `_authenticated/attendance.tsx`, `_authenticated/salary.tsx`, `_authenticated/staff.tsx`, `_authenticated/analytics.tsx`, `_authenticated/payments-reports.tsx` (or convert to redirects)
  - Update: `master-data.tsx` to render sectioned tabs incl. Rooms, Rates
  - Update: `cash.tsx` to drop master tabs
  - Update: `app-sidebar.tsx` to new nav set
- FabHotels parser lives next to Hotelzify parser in `hotelzify-poll.ts` (renamed to `integrations-poll.ts`); registry pattern: `{ hotelzify: parseHotelzify, fabhotels: parseFabhotels }`.

## Scope check before I start

This is ~15-20 file changes plus 1-2 migrations. I'll do it in one pass without intermediate check-ins unless you want a different sequencing. **Two quick confirmations:**

1. For Cashbook master tabs that look nicer than current Master Data UI — port the nicer UI into Master Data (replacing current), or just delete and use what's there?
2. Staff Management — single page with in-page tabs (simpler), or separate routes per tab `/staff-management/master`, `/staff-management/attendance`, `/staff-management/salary`?

Reply with answers (or "your call on both") and I'll ship it all.
