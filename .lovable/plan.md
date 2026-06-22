# Batch B — Guest Portal Maturity (single shipment)

## 1. Database (one migration)

`guest_documents`
- Add `verified_at timestamptz`, `verified_by_name text` (used by Profile Completion: "verified" = doc has front + at least one other side OR explicit `verified_at`).

`guest_reviews`
- Add `customer_id uuid`, `source text` (e.g. `Guest Portal`),
  `feedback_what_went_wrong text`, `feedback_additional_comments text`,
  `routed_to_external boolean` (true when 4–5 stars routed to external review URL).
- Grant `INSERT` to `anon` via a narrow RLS path that only fires through the
  signed token (the actual write goes through `supabaseAdmin` from a server
  fn, so policies are belt-and-braces).

`app_settings`
- Reuse: `documents_retention` (already exists), `external_review_url` (new
  optional key, defaults to `https://hotelexcella.in/review`).

## 2. Portal server functions (`src/lib/portal.functions.ts`)

All token-scoped, public (no auth middleware), validated through
`booking_tokens`. Files crossed over JSON as base64 (ID photos are small).

- `listPortalDocuments(token)` → same shape as `listGuestDocuments`.
- `uploadPortalDocument(token, doc_type, notes, front_b64?, back_b64?, selfie_b64?, allow_missing_front?)` → uploads to `customer/<id>/...` (or booking/<id> when no customer yet) via `supabaseAdmin`, inserts row with `source = "Guest Portal"`. Verification on portal uploads stays NULL — staff verify from PMS.
- `softDeletePortalDocument(token, doc_id)` → only allowed if doc belongs to this booking's customer or booking.
- `cancelPortalBooking(token)` → enforces: now ≤ check-in − 24h AND `advance_paid == 0`; sets status `Cancelled`, `cancel_reason = "Guest self-cancelled (portal)"`; otherwise throws a clear "contact reception" error.
- `submitPortalComplaint(token, category, description)` → inserts into existing `complaints` table with `complaint_type = "General"`, `priority = "Medium"`, `entered_by_name = "Guest (Portal)"`, `customer_id`, `booking_id`, `category`, `description`. (Existing module — no new tables.)
- `submitPortalReview(token, rating, comment?, what_went_wrong?, additional_comments?)` → inserts into `guest_reviews`. Server returns `{ externalReviewUrl }` when `rating >= 4` so the client can redirect.

## 3. `GuestDocumentsDialog` extension (no new modal)

Add an optional `portalToken?: string` prop. When set, the dialog swaps its
data layer (list / create / soft-delete) to call the portal server fns
instead of the authenticated `supabase` client. The UI, document types,
fields, capture/replace/upload-additional flows are unchanged. All other
call sites (Booking Details, Customer Page, PMS) remain identical.

## 4. Portal UI changes (`src/routes/portal.$token.tsx`)

Single mobile-first page, theme unchanged. Sections added in this order:

```text
[Booking Overview]      (existing)
[Profile Completion]    (rewritten — email, arrival time, verified doc)
[Your Details form]     (existing — arrival date+time kept exactly)
[Documents card]        (NEW — opens GuestDocumentsDialog with portalToken)
[Order Food]            (NEW — links to https://hotelexcella.in/orderfood, target=_blank)
[Report Complaint]      (NEW — opens compact form; submits via portal fn)
[Reviews & Feedback]    (NEW — 5-star picker; ≥4 redirects, ≤3 opens feedback form)
[Cancel Booking]        (NEW — visible only when allowed; otherwise a "contact reception" notice)
[Payment options]       (existing)
```

Profile completion formula:
```
checks = [hasEmail, hasExpectedArrivalAt, hasAnyVerifiedDocOrAtLeastOneDocOnFile]
pct = round((passed / 3) * 100)
```
Documents contribute if at least one document row exists with a front file
(treated as verified when `verified_at` is set, or front+selfie+back captured).

## 5. Tiny supporting bits

- `src/components/portal/order-food-card.tsx`, `report-complaint-card.tsx`, `reviews-card.tsx`, `cancel-booking-card.tsx` — purely presentational, all in portal theme.
- `app-settings-api.ts` gains `getExternalReviewUrl()` helper with default fallback.
- All portal fetches happen via existing `useQuery(["portal-booking", token])`, with `q.refetch()` after each mutation.

## 6. UAT (verified before closing)

1. Portal upload Aadhaar → row appears with `source = Guest Portal` and `customer_id` set; Customer Documents card on PMS shows "Uploaded from: Guest Portal".
2. Re-bind booking 6 months later (same customer) → `listPortalDocuments` returns prior IDs (union via customer_id). No re-upload needed.
3. Replace document → old row soft-deleted, new row active, prior booking history retained.
4. Update email via portal → `customers.email` reflects new value (existing trigger).
5. Cancellation:
   - check-in 48h away, no payment → cancel succeeds.
   - check-in 12h away → "contact reception".
   - any advance paid → "contact reception".
6. Complaint → `complaints` row created with `booking_id`, `customer_id`, `category`, `description`, `entered_by_name = "Guest (Portal)"`.
7. Reviews:
   - 5 stars → response includes `externalReviewUrl`, client opens it.
   - 2 stars → feedback form opens, row saved with `feedback_*` fields, no redirect; toast confirms.

## Out of scope (per your spec)

- Loyalty / Rewards, AI concierge, digital key, WhatsApp.
- Booking Engine back-navigation improvements.
- Iframe embed for Order Food (link in new tab for now).
- Settings UI for the external review URL (we read from `app_settings`; setting it can be a follow-up).

Files touched (estimate):
- New: 4 portal sub-components, 1 migration.
- Edited: `portal.functions.ts`, `portal.$token.tsx`, `guest-documents-dialog.tsx`, `guest-documents-api.ts` (only types), `app-settings-api.ts`.

Approve and I will execute end-to-end in the next turn.
