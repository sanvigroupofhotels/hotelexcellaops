## Scope

Two P1 stability fixes, then the remaining approved items from prior sprints. Keep all existing tables/triggers/dropdowns intact — only UI consolidation under Master Data.

---

## P1 #1 — Booking Detail page React error #310 (intermittent "Something didn't load")

**Diagnosis**: Error #310 = "Rendered more hooks than during the previous render" — hook order changes between renders. Most likely cause in `bookings_.$id.tsx`: early `return` on loading/error happens **after** other hooks in some paths, or a conditional hook later in the 881-line component. The `useState`/`useMutation`/`useQuery` block at the top is fine, but the lower JSX has conditional `Route.useLoaderData`/derived logic that may bail before later hooks run on first paint after create/save.

**Fix**:
- Audit `src/routes/_authenticated/bookings_.$id.tsx` for any early `return` (e.g. `if (isLoading) return …` or `if (!b) return …`) placed before the last hook call. Move all hook calls to the top of the function so they always execute.
- Wrap the route in an `errorComponent` + `notFoundComponent` so the user gets graceful retry instead of a blank "Something didn't load".
- Add `useAuthReady`-style gate: defer `useQuery` `enabled` flags until session is restored, to avoid mid-render auth flip on freshly-created bookings (the Lovable Stack Overflow pattern shown in context).
- Ensure `invalidateAll()` after create/save invalidates the new booking's queryKey rather than navigating to a not-yet-cached id.

---

## P1 #2 — Guest Portal "Link expired or invalid"

**Diagnosis**: `publicOrigin()` now points at `https://hotelexcellaops.lovable.app` which serves the **published** build. If the user hasn't republished since the portal route was added, the published bundle 404s on `/portal/$token` (TanStack returns notFoundComponent → "Link expired"). Token insert/read path is correct.

**Fix**:
- Verify `booking_tokens` row is actually created (the `issueBookingToken` server fn looks correct; double-check by reading a row right after share). Add server-side `console.log` of inserted token + lookup result so logs surface the real reason in `server-function-logs`.
- Differentiate "invalid token" vs "expired" vs "revoked" in `getPortalBooking` error messages so the portal UI shows the actual cause (not always "expired").
- Prompt user to **republish** so `/portal/$token` exists on `hotelexcellaops.lovable.app`. If they prefer not to republish on every share, fall back `publicOrigin()` to `window.location.origin` for `id-preview` host (preview host is auth-gated, but they can manually test in the same browser session where they're logged in).

---

## Remaining approved items (UI/feature work; no FK or trigger changes)

### Master Data hub — UI consolidation only
- Add tabs/sections in `master-data.tsx` for: Rooms (deep-link existing /rooms), Rates & Inventory (deep-link /rates), CashBook Staff (deep-link /cash staff tab), Expense Types (inline editor on `expense_types` table), Complaint Categories (inline editor on `complaint_categories` table), Booking Settings → Payment Settings (new).
- Reuse `CategoryEditor` pattern for `expense_types` and `complaint_categories` via a small `useTableMasterData(tableName)` helper. No schema change.

### Global Payment Settings (new)
- New `app_settings` table (singleton row) with: `allow_full_payment`, `allow_part_payment`, `default_part_payment_percent`, `allow_pay_at_hotel`. Admin-only write, authenticated read.
- New `usePaymentSettings()` hook reading the row.
- Wire into: New Booking form (defaults for part_payment_type/value), Guest Portal payment options (hide disabled methods), Edit Booking (override allowed).

### Bookings/Quotes — Extras + Editable Total + Taxes Included
- Audit `line-items-editor.tsx` extras toggles (Early Check-In, Late Check-Out, Pet Stay, Extra Adults, Driver Stay) — confirm each updates only its own row.
- Add `taxes_included boolean` + `total_override numeric` columns to `bookings` and `quotes` (nullable).
- `pricing.ts`: when `total_override` is set, back-compute subtotal from it (respecting `taxes_included`).
- Pricing breakdown shows override badge.

### Rates & Inventory
- Already fixed string-based Bulk Apply. Verify with a UAT test (11→14 produces exactly 11,12,13,14).
- Single room type select already in place — confirm UI.
- Mobile UX polish (vertical form, swipeable cards).

### House View
- Date column separation, breakfast indicators, House Overview stats.
- Room-assignment conflict rules — `room-assignment-field.tsx` hides Occupied/Blocked rooms; shows future-assigned with warning toast.

### CashBook
- Staff view restricted via `useUserRole`.
- Admin reports: Paid To Owner totals, CSV/PDF exports (reuse existing CSV helpers).

---

## Database migrations

1. `app_settings` singleton (id text default 'global', columns above, RLS: read for authenticated, write for admin via `has_role`).
2. ALTER `bookings` + `quotes` ADD COLUMN `taxes_included boolean DEFAULT false`, `total_override numeric NULL`.

No changes to existing triggers, FKs, or dropdown wiring.

---

## Execution order

1. P1 #1 hook fix + errorComponent on booking detail.
2. P1 #2 — add diagnostic logs + better error messages; instruct republish.
3. Migrations (app_settings, taxes_included, total_override).
4. Payment Settings UI + wiring.
5. Master Data hub tabs (expense_types, complaint_categories, deep-links).
6. Extras audit + editable Total + Taxes Included checkbox.
7. House View polish + room-assignment rules.
8. CashBook role split + exports.

---

## Out of scope

- Razorpay live keys / webhook hardening beyond what's shipped.
- New auth flows.
- Visual redesigns not listed.

This is a **large** pass. Realistic risk: items 5–8 may need a follow-up turn. P1s + migrations + items 3–4 will land first to keep the system stable.
