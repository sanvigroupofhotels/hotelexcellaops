## Scope

One implementation pass covering all remaining deferred features. Below is what gets built, the data model, and where each piece plugs into the existing app. After approval I'll execute migrations + code in batched edits.

---

## 1. Rate Management Calendar

**New page:** `/rates` (admin-only, under `_authenticated`), linked from sidebar under "Operations".

**Data model (new tables):**

```text
room_rates                          -- per room_type baseline
  room_type        text PK
  default_rate     numeric
  weekday_rate     numeric NULL     -- falls back to default
  weekend_rate     numeric NULL     -- Sat+Sun by default
  updated_at, updated_by

rate_overrides                      -- date-specific
  id uuid PK
  room_type        text
  date             date
  rate             numeric
  note             text NULL
  created_by, created_at
  UNIQUE(room_type, date)
```

**Resolver** (`src/lib/rates.ts`): `resolveRate(room_type, date)` → override → weekend/weekday → default. Bulk variant `resolveRatesForRange()` used by Quotes/Bookings line-items when adding a room.

**UI:**
- Month calendar grid, rows = room types, columns = dates, cells show effective rate (override highlighted gold).
- "Set Defaults" dialog per room type (default / weekday / weekend).
- "Bulk Apply" dialog: room type(s) + date range + rate → upserts overrides.
- Click cell → edit/clear single-date override.

**Pricing integration:** `bookings_.new.tsx`, `bookings_.$id_.edit.tsx`, `quote.$id_.edit.tsx` — when a room line item is added/changed, auto-fill `rate` from resolver (user can still override the input). No change to `src/lib/pricing.ts` (totals model stays).

---

## 2. Room Blocking

**Extend existing `room_maintenance` table** (already has start/end/reason) — rename usage to "blocks" and add:
- `blocked_by uuid`, `blocked_at timestamptz`
- `unblocked_by uuid NULL`, `unblocked_at timestamptz NULL`
- `active boolean default true`

**API:** extend `src/lib/rooms-api.ts` with `blockRoom`, `unblockRoom`, `getActiveBlock(room_id, date)`.

**Conflict prevention:** new trigger `bookings_prevent_block_conflict` — refuses booking insert/update overlapping an active block (admin override allowed, mirrors existing `bookings_prevent_room_conflict`).

**Available-room selector** (`room-assignment-field.tsx`) filters out rooms with active block covering the stay dates.

---

## 3. House View Enhancements

In `house-view.tsx`:
- Add "Blocked" state badge + reason tooltip on room cards.
- Click handler dispatches by state:
  - **Vacant** → menu: *Create Booking* (prefills `room_id`, `room_type` via URL params on `/bookings/new`) · *Block Room*
  - **Blocked** → menu: *View Details* · *Edit Block* · *Unblock* (records unblocked_by/at)
  - **Occupied** → existing booking link (unchanged)
- `bookings_.new.tsx` reads `?room_id=&room_type=` search params and prefills.

---

## 4. Inventory States

Single derived helper `getRoomState(room, date)` → `"vacant" | "occupied" | "blocked"` based on:
- active booking (`Checked-In` OR Confirmed/Advance/Full-Paid with date ∈ stay) → occupied
- active block covering date → blocked
- else vacant

Used by House View, room selectors, and (future) rate calendar occupancy overlay.

---

## 5. Master Data

**New table:**

```text
master_data
  id uuid PK
  category text   -- 'lead_source' | 'tag' | 'expense_type' (future) | 'complaint_category' (future)
  value    text
  label    text
  sort_order int default 0
  active   boolean default true
  UNIQUE(category, value)
```

Seed with current hardcoded lead sources (Direct, Walk-In, Phone, WhatsApp, Booking.com, MMT, Treebo, Hotelzify) and tag examples (VIP, Warm Lead, Corporate, Repeat Guest).

**Admin page:** `/master-data` (admin-only) — tabbed UI per category, CRUD with sort + active toggle.

**Refactor consumers:** replace hardcoded `LEAD_SOURCES` arrays in booking/quote/customer forms with `useMasterData('lead_source')` hook (TanStack Query, 5-min stale).

`expense_types` and `complaint_categories` already exist as separate tables — leave them; surface them through the same Master Data page as additional tabs for unified admin UX.

---

## 6. Guest Portal Foundation (non-UI)

No guest-facing pages this pass. Confirm existing `booking_tokens` table supports public tokenized URLs (it does). No schema work needed beyond ensuring `bookings` exposes `subtotal/discount/tax_rate/taxes/total` which we already migrated. Note: Razorpay link generation will require a secret + edge route later — out of scope.

---

## Migration Summary

One migration file creating: `room_rates`, `rate_overrides`, `master_data`; altering `room_maintenance` with audit cols; adding `bookings_prevent_block_conflict` trigger; seeding master data; GRANTs + RLS (admin write, authenticated read on master/rates; admin write on blocks).

## File Plan

- **New:** `src/lib/rates-api.ts`, `src/lib/rates.ts` (resolver), `src/lib/master-data-api.ts`, `src/hooks/use-master-data.ts`, `src/routes/_authenticated/rates.tsx`, `src/routes/_authenticated/master-data.tsx`, `src/components/block-room-dialog.tsx`, `src/components/room-action-menu.tsx`
- **Edited:** `src/lib/rooms-api.ts`, `src/components/app-sidebar.tsx`, `src/components/room-assignment-field.tsx`, `src/routes/_authenticated/house-view.tsx`, `src/routes/_authenticated/bookings_.new.tsx`, `src/routes/_authenticated/bookings_.$id_.edit.tsx`, `src/routes/_authenticated/quote.$id_.edit.tsx`, lead-source consumers (customer forms, etc.)

## Out of scope (explicit)

- Guest-facing portal pages
- Razorpay integration
- Migrating expense_types/complaint_categories tables into master_data (kept separate, just surfaced in same admin UI)

Approve and I'll execute the migration + code in batched parallel edits.