
This is a large consolidated batch. I'll group the work into shippable phases so we can verify each one before moving on, rather than touching everything at once. Phases 1–4 are this turn's commitment; 5–7 follow once those land cleanly.

## Phase 1 — Data cleanup & customer/mobile integrity

**1.1 FabHotels purge** — Re-run the cleanup (anything that crept back in since the last sweep): delete `customers` and `bookings` where `lead_source = 'FabHotels'`, cascading through payments / charges / activities / items / room assignments / tokens / guest_documents.

**1.2 Hotelzify mobile repair** — One-shot SQL repair:
- For each booking where `lead_source = 'Hotelzify'` AND booking `phone` is valid AND linked `customers.phone` is blank → copy booking phone to customer.
- Skip & log reasons: blank booking phone, customer already has a phone (no overwrite), phone equals the known hotel reception number, phone appears on ≥3 distinct customers (OTA shared number heuristic).
- Report totals back in chat (repaired / skipped / skip reasons).

**1.3 Booking → Customer mobile sync (ongoing)** — Add a trigger on `bookings` UPDATE: when `phone` changes and the linked customer's phone is blank, copy it over. Never overwrite a non-blank customer phone.

## Phase 2 — OTA integration hardening (UI-driven config + dedupe + preview)

**2.1 Config-driven Hotelzify/email integrations** — Extend the existing `integrations` row config to surface all knobs in the integration detail UI (`settings_.integrations.$id.tsx`):
- sender_email, inbox_email, subject_filters[], lookback_days, sync_minutes, lead_source, search_query_override, allow_updates (default false), field_aliases{}, enabled.
- Remove any remaining hardcoded constants from `hotelzify-poll.ts` — read everything from the row.

**2.2 Stronger dedupe** — In the poller, dedupe on `(source, external_booking_id)` first, then fall back to `(source, guest_mobile, check_in, check_out)`. If a match is found and `allow_updates = false` → skip with reason "Updates disabled". If `true` → patch only `amount`, `advance_paid`, balance, `status`, `special_requests`; never touch name/phone/room/notes.

**2.3 Preview mode** — Add a "Dry Run" button on the integration detail page that calls the poller with `?dryRun=1`, returns counts (scanned / would create / would update / would skip / potential duplicates) and shows a confirm dialog before a real run.

## Phase 3 — Payments, OCR, check-in & guest docs

**3.1 Payment Settings relocation** — Move the Payment Settings section out of Master Data into a new `/settings/payment-settings` route and add a sidebar entry under Settings. New bookings inherit these defaults; edit forms remain free to override per-booking.

**3.2 Mobile mandatory at check-in for OTA bookings** — In `bookings_.$id.tsx` check-in dialog, if `lead_source` is an OTA and `phone` is blank, render a required input and block the check-in mutation until a valid phone is entered. Save the entered phone back onto the booking (which then triggers 1.3 to sync to customer).

**3.3 Guest Documents — Front ID requirement** — Already partially done last turn. Double-check `guest-documents-dialog.tsx` Proceed gating: enabled when any of {front newly picked, front already on file, back picked, selfie picked} — confirm with a quick read of the file and tighten if regressed.

**3.4 Payment History as single source of truth** — Audit every payment creation site (OCR, manual add, receive payment, UPI, cash, booking detail, house view popup, Due Collection, refund) and confirm each writes through `createBookingPayment` / `booking-payments-api`. Any direct `cash_transactions` insert that should also produce a `booking_payments` row gets refactored.

**3.5 Payment OCR UAT** — Run sample BharatPe/PhonePe/GPay/Paytm screenshots through `payment-ocr.functions.ts`, capture which fields extract reliably, tighten prompts/regex for weak ones. (Manual UAT step — I'll report a matrix.)

## Phase 4 — Guest comms: check-in/out **time** everywhere

Sweep every guest- or staff-facing booking summary and ensure dates render with the configured check-in/check-out times from `useOpsTimeLabels()` / `getOpsTimeLabels()`:
- Guest Portal, Booking Preview, Confirmation link, WhatsApp confirmation, Proforma Invoice, Final Invoice, Email templates, Booking Detail, House View popups, Reservation popups, OTA imported booking summaries.

Audit list of files I'll touch: `invoice-dialog.tsx`, `portal/*`, `booking-messages.ts` (verify), `quote-messages.ts`, `house-view.tsx` popovers, `bookings_.$id.tsx` summary header, and any other date-only render found via `rg`.

## Phase 5 — Invoice & Proforma redesign + signature

- Redesign `invoice-dialog.tsx` for a denser, single-page, hotel-grade layout: refined header (logo block, GSTIN, contact strip), clearer guest/stay grid, tightened charges/taxes/totals table, distinct payments + refunds sections, polished footer.
- Add a `signature_url` (+ optional `signatory_designation`) to Branding settings with file upload to a new `branding` storage bucket. Render at bottom-right of Invoice & Proforma above "Authorized Signatory · Hotel Excella · Sanvi Group of Hotels".

## Phase 6 — Light theme default

`theme-toggle.tsx` currently defaults to dark when no preference exists. Change `getInitialTheme()` fallback to `"light"` and apply at the SSR entry so first paint is light. Dark remains opt-in via the toggle.

## Phase 7 — Stabilization UAT (no code; report findings)

Run targeted UAT passes on: payment consistency across all entry points, refund flow, business date / night audit interaction, OCR accuracy matrix, guest documents requirement matrix. Report findings and queue fixes.

## FabHotels Deep UAT — still parked for next release.

---

### Scope this turn

I'll execute **Phase 1, 2, 3, 4, 6** in this turn (data + integrations + payments + comms + light theme default). Phase 5 (invoice redesign + signature upload) is a meaningful design pass that deserves its own turn so we can iterate on the layout. Phase 7 UAT findings will follow.

OK to proceed on that scoping?
