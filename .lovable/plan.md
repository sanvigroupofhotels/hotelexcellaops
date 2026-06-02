
# Turn 5 — Customer Maturity, Multi-Line Quotes, Booking Foundation

A large turn touching schema, generate flow, edit flow, PDF/WhatsApp/share, and a brand-new bookings surface. Sequenced to keep the app working at every step.

## Module 1 — Customer Profile Maturity

- **Edit Customer modal** on `customers_.$id.tsx`: name, phone, email, city, state, country, company_name, gst_number, company address (reuse `special_notes`-style or add `company_address` column), birthday, anniversary, preferred_room, preferred_food.
- **Lead Source** options expanded in `mock-data.ts` to the 10 listed (Walk-in, Phone Call, WhatsApp, Website, Google Business Profile, Travel Agent, Corporate Referral, Repeat Guest, OTA, Other).
- **Tags**: already multi-select; expand `DEFAULT_TAGS` to the 7 listed.
- **Internal Notes**: already present; confirm exclusion from PDF/WhatsApp/share (audit `share-quote.ts` and `quote-summary.tsx`).
- **Customer Actions** row: Call, WhatsApp, Create Quote (already there), + **Create Booking** linking to `/bookings/new?customerId=...`.
- **Insights**: Total Quotes, Latest Quote, Lifetime Quoted Value are already shown. Add placeholder Bookings stat (count from new table).

## Module 2 — Advanced Quote Creation

### Schema
- New `quote_items` table:
  - `id`, `quote_id` FK, `position` int, `room_type`, `adults`, `children`, `check_in`, `check_out`, `nights` (generated or computed), `breakfast_included`, `extra_bed`, `rate`, `subtotal`, `notes`, timestamps.
  - RLS: same shared-team model as `quotes` (SELECT all authenticated; INSERT/UPDATE/DELETE gated by parent quote ownership via `EXISTS` on quotes.user_id).
  - GRANTs to `authenticated` + `service_role`.
- Backfill: trigger or one-shot SQL inserting one `quote_items` row per existing `quotes` row from current columns.
- Keep legacy columns on `quotes` for now (rooms, room_type, room_rate, check_in, check_out, adults, children, nights, subtotal) — they become the rollup/summary; `quote_items` is the source of truth going forward.

### Customer Lookup on Generate
- Debounced autocomplete on phone & name fields in `generate.tsx`.
- Query top 5 matches (`ilike`). Dropdown shows name, phone, quote_count.
- If match found before submit: banner "Existing Customer Found" with [Use Existing Customer] (default) / [Create New Anyway]. Selecting an existing customer prefills all fields and sets `customer_id`.

### Line Items UI
- `generate.tsx` and `quote.$id_.edit.tsx`: add a Line Items section.
- Controls: Add Line, Duplicate Line, Remove Line.
- Each line: Room Type, Adults, Children, Check-In, Check-Out, Breakfast toggle, Extra Bed, Rate. Subtotal auto-computed (nights * rate + extras).
- Quote-level summary aggregates: total nights span (min check_in → max check_out), total guests, sum subtotal → taxes → discount → total.
- PDF, WhatsApp, share image (`share-quote.ts`, `quote-summary.tsx`, `quote.$id.tsx`) updated to render each line item.

## Module 3 — Booking Foundation

### Schema
- New `bookings` table:
  - `id`, `user_id`, `customer_id` FK (NOT NULL), `source_quote_id` FK nullable, `booking_reference` (auto `HEXB-NNN`-style), `check_in`, `check_out`, `nights`, `guests`, `adults`, `children`, `room_details` text, `amount` numeric, `notes`, `internal_notes`, `status` ('Draft' | 'Confirmed' | 'Cancelled'), `payment_status`, timestamps.
  - RLS mirrors quotes (shared-team SELECT, INSERT auth, UPDATE WITH CHECK ownership, DELETE admin).
  - GRANTs to `authenticated` + `service_role`.
- `customers.total_bookings` already exists — wire trigger to recompute on bookings change.

### Routes
- `src/routes/_authenticated/bookings.tsx` — list (search + status filter + CSV export pattern reused from history).
- `src/routes/_authenticated/bookings.new.tsx` — create form. Accepts `?customerId=` and `?fromQuoteId=` search params.
- `src/routes/_authenticated/bookings.$id.tsx` — detail view with status switcher.
- Sidebar entry: "Bookings" with calendar/bed icon.

### Convert Quote → Booking
- On `quote.$id.tsx`, add "Convert to Booking" action (Confirmed quotes). Navigates to `/bookings/new?fromQuoteId=...` prefilled from quote + its line items rolled up.

### Customer linkage
- Customer Profile gains a "Bookings" section listing bookings for that customer (placeholder if 0), separate from the existing Quotes list.

## Property-Awareness Hygiene

- New strings avoid hardcoded "Hotel Excella"; pull brand name from existing config where present (Topbar / share templates).
- No multi-property tables this turn.

## Out of Scope (explicit)

- Check-in/out workflows, housekeeping, room inventory, channel manager, multi-property, SaaS billing.

## Technical Sequencing

1. Migration 1: `quote_items` + backfill + RLS + GRANTs.
2. Migration 2: `bookings` + RLS + GRANTs + trigger to recompute `customers.total_bookings`.
3. Migration 3: customer field additions (`company_address` if needed).
4. APIs: `quote-items-api.ts`, `bookings-api.ts`; extend `customers-api.ts` with `searchCustomers(phoneOrName)`.
5. UI: Generate (lookup + line items), Edit (line items), Customer Profile (edit modal + Create Booking + Bookings list), Bookings routes, sidebar.
6. Render layer: PDF / WhatsApp / share image / quote detail iterate over line items with backwards-compatible fallback (if a quote has 0 items, render legacy columns).
7. `mock-data.ts`: expand `LEAD_SOURCES`, `DEFAULT_TAGS`, add `BOOKING_STATUSES`.

## Risks / Mitigations

- **PDF/WhatsApp/share regression**: keep legacy single-line fallback for any quote with no `quote_items` rows.
- **Edit page rate parity**: reuse `NumField` component for line-item rate/extras.
- **RLS on quote_items**: insert/update/delete policies check `EXISTS(quotes WHERE id = quote_id AND user_id = auth.uid())` for owner gating, and shared SELECT (`true`) consistent with quotes table.
- **Realtime**: add `quote_items` and `bookings` to existing `useRealtimeInvalidate` channels.
