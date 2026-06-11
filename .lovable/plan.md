
## Root cause

The codebase computes "today" using `new Date().toISOString().slice(0, 10)`. `toISOString()` always converts to **UTC**, so for users in IST (UTC+5:30) every day from **00:00 to 05:30 IST**, the resulting string is **yesterday's** date. Date columns in the DB (`check_in`, `check_out`, etc.) are stored as **local** `YYYY-MM-DD` strings, so comparisons against this UTC-derived "today" silently shift by one day.

This is why the Bookings list shows yesterday's check-ins as "today" — the bucket at line 43 of `src/routes/_authenticated/bookings.tsx` uses `today.toISOString().slice(0, 10)`.

## Fix

1. Add a `toLocalYMD(date = new Date())` helper in `src/lib/utils.ts` that returns the **local** `YYYY-MM-DD` (using `getFullYear` / `getMonth` / `getDate`, zero-padded).
2. Replace every `…toISOString().slice(0, 10)` that represents a **calendar date** (today, tomorrow, default check-in/out, comparison against a local date column, CSV filename stamps, key generation against local dates) with `toLocalYMD(...)`.

## Files updated

- `src/lib/utils.ts` — add `toLocalYMD` helper
- Bookings ordering (primary bug):
  - `src/routes/_authenticated/bookings.tsx`
  - `src/routes/_authenticated/bookings_.$id.tsx`
- Default check-in/out and "today" defaults:
  - `src/components/shared/stay-form-sections.tsx`
  - `src/components/block-room-dialog.tsx`
  - `src/components/line-items-editor.tsx`
  - `src/lib/booking-items-api.ts`
  - `src/lib/quote-items-api.ts`
  - `src/routes/_authenticated/quote.$id_.edit.tsx`
  - `src/routes/_authenticated/generate.tsx`
- Today comparisons / range filters:
  - `src/routes/_authenticated/tasks.tsx`
  - `src/routes/_authenticated/payments-reports.tsx`
  - `src/routes/_authenticated/rates.tsx`
  - `src/lib/rates.ts`, `src/lib/rates-api.ts`
  - `src/routes/_authenticated/customers_.$id.tsx`
  - `src/lib/complaints-api.ts`
  - `src/routes/_authenticated/house-view.tsx` (calendar key generation)
- CSV filename / created-on stamps (cosmetic, but should also reflect local day):
  - `src/routes/_authenticated/customers.tsx`
  - `src/routes/_authenticated/complaints.tsx`
  - `src/routes/_authenticated/cash.tsx`
  - `src/routes/_authenticated/history.tsx`
  - `src/routes/_authenticated/bookings.tsx` (export filename + Created col)

Untouched: any `toISOString()` that represents a **timestamp** (created_at, full ISO with time) — those are correct as UTC.

## Verification

- Open Bookings list in early IST morning (or temporarily mock clock) → today's check-ins appear first, then tomorrow → future (asc), then past (desc).
- New Booking and New Quote default check-in = local today, check-out = local tomorrow.
- "Today" filter in Tasks shows tasks dated to the local calendar day.
