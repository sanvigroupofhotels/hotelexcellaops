## Consolidated Hardening Shipment — Plan

This shipment closes the remaining operational items. I'll group the work into focused phases and ship in this order. Items 8 (keep OTAs disabled) and 9 (UAT) are policy/QA and need no code.

---

### Phase A — Access Management restoration (items 1 + 2)

**Restore the Access Settings page** under Settings → Access Management. Route: `/settings/access`. The page already exists at `src/routes/_authenticated/access-settings.tsx` and the API/tables (`roles`, `permissions`, `role_permissions`, `has_role`) are intact — it was only unlinked from the sidebar.

- Add **Access Management** as a 6th item in the Settings expandable group in `app-sidebar.tsx` (admin only).
- Add a new route file `settings.access.tsx` that renders the existing access-settings UI inside the Settings layout (or move the page in-place and redirect the old path).
- Wire the **Bookings** menu item + `/bookings` route to a permission key (`bookings.view`). Hide in sidebar AND block direct URL via a `beforeLoad` permission check that redirects non-permitted users to `/house-view`.
- Seed default matrix:
  - Bookings list → Owner ✓, Admin ✓, Reception ✗, Staff ✗
  - House View, Due Collection → all roles ✓
  - User Management, Settings, Master Data → Owner ✓, Admin ✓ only
- Reception/Staff land on `/house-view` after login (already their default per `AdminOnly`).

### Phase B — Communication time sweep (item 3, HIGH PRIORITY)

Audit every guest- and staff-facing booking summary and replace any `format(date, "dd-MMM-yyyy")` of check-in/out with `formatStayDateTime(date, opsTimes)` using `useOpsTimeLabels()` / `getOpsTimeLabels()` from `src/lib/check-times.ts`.

Surfaces to sweep:
- Guest Portal (`portal.$token.tsx`)
- Booking Detail (`bookings_.$id.tsx`) — header summary
- Booking Preview / Confirmation link rendering
- Proforma + Invoice (`invoice-dialog.tsx`, `quote.$id.tsx`)
- Email templates / `booking-messages.ts` (re-check)
- House View popup + Reservation popups (`house-view.tsx`)
- OTA imported bookings display
- Customers detail booking list, Dues page

Pattern: render as `17-Jun-2026, 1:00 PM` (date + time from Operations settings).

### Phase C — Payment Settings relocation (item 4)

- New route `src/routes/_authenticated/settings.payment-settings.tsx` rendering the existing `payment-settings-section.tsx`.
- Add to Settings sidebar group between **Documents Retention** and **Integrations**.
- Remove the Payment Settings tab/section from Master Data.
- Confirm `bookings_.new.tsx` and `bookings_.$id_.edit.tsx` already read defaults from app_settings on create (they do — `payment_terms`, `cancellation_policy`, etc. are inherited). Document override behavior in payment-settings UI copy.

### Phase D — Invoice & Proforma redesign + signature (items 5 + 6)

- Redesign `invoice-dialog.tsx` for a hotel-grade single-page layout:
  - Header: logo + hotel block (left), invoice meta (right)
  - Guest + Stay summary (two-column, includes check-in/out time from C)
  - Charges table with right-aligned amounts, GST breakdown
  - Totals block (subtotal / discount / tax / total / paid / balance)
  - Payment history compact strip
  - Refunds section only when present
  - Footer: terms + bank details + signature
- **Signature**: add `signature_url` and `signatory_designation` to Branding settings.
  - Create storage bucket `branding` (public-read).
  - Upload control in `settings.branding.tsx`.
  - Render bottom-right of Invoice + Proforma: "Authorized Signatory / [image] / Hotel name / Group name".
- Same layout applied to proforma rendering in `quote.$id.tsx`.

### Phase E — OTA Preview / Dry-run mode (item 7)

- Add `?dryRun=1` support to `hotelzify-poll.ts` (and FabHotels poller when wired): same parse + dedupe pipeline, no writes; returns `{ scanned, wouldCreate, wouldUpdate, wouldSkip, potentialDuplicates, items[] }`.
- In `settings_.integrations.$id.tsx`, add **Run Preview** button next to **Run Now** that calls the poller in dry-run and displays a summary modal with the counts and per-email status, then offers **Import** (real run) or **Cancel**.

### Phase F — Items 8 + 9

- Hotelzify and FabHotels remain `enabled = false`. Verified — no change.
- UAT — I'll spot-check each surface in B (comms times), D (invoice/proforma), payment consistency, refund flow, guest documents, business date / night audit after shipping, and report findings.

---

### Out of scope this turn

- FabHotels Deep UAT — parked per your instruction.
- New email templates beyond time-format fixes.

### Order of execution

A → B → C → E → D (largest visual work last) → F (verify).

If anything in this scope should be deferred to a follow-up shipment, say which phase to drop and I'll proceed with the rest.
