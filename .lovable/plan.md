# HEOS Core v1.1 — Stabilization Sprint 3

Single stabilization shipment covering the remaining operational gaps. All work reuses existing shared engines (`booking-pricing-sync`, `booking-charges-api`, `booking-activities-api`, `hk-checkout-hook`, `laundry-batches-api`, `useMasterData`, `PermissionGate`).

---

## P0 — Finance & Payments

### UAT-025 — Razorpay convenience-fee as In-house Charge

**Root cause**: current webhook records the full `amount_paid` as a `booking_payment` and does not split the overpayment into a distinct charge. Sprint 2 wired a ledger-side split, but not an operational "In-house Charge" visible in the booking's charges tab / activity log.

**Fix** (`src/routes/api/public/razorpay-webhook.ts`):

1. After we settle the booking due, if `paid_paise > due_paise`, create a `booking_charge`:
  - `category = 'Razorpay Charges'` (idempotently seeded in `charge_catalog` at first use)
  - `amount = overpayment`
  - `description = 'Razorpay convenience fee (auto)'`
  - `is_system_generated = true` flag preserved in `notes` or a metadata field
2. Log a `booking_activity`: `event_type='razorpay_fee_adjustment'` with actor `system`, message identifying it as auto-generated.
3. Idempotency: guard on `razorpay_payment_id` so retries don't duplicate the charge.
4. Keep existing payment recording untouched.

### UAT-028 — Payment Modes single source of truth

`add-booking-payment-modal.tsx` already uses `useMasterData("payment_method", PAYMENT_MODES)`. Audit and confirm:

- No other add-payment surface uses hardcoded `PAYMENT_MODES` (search `bookings_.$id.tsx`, `cash.tsx`, portal payment flows).
- Rename Master Data tab label to **Finance → Payment Modes** (category key stays `payment_method` for backward compat).
- Document in `docs/master-data.md` (or `modules.md`) that `payment_method` is the SoT and Cash → Cash Book routing is preserved in `booking-payments-api.createBookingPayment`.

---

## P1 — Booking Audit

### UAT-029 — Booking Creation audit trail

**Fix** (`src/lib/booking-create.ts`): after inserting the booking, always insert a `booking_activities` row `event_type='booking_created'` with structured payload:

```
{ created_by, working_as, source, initial_status, room_ids, checkin_date, checkout_date }
```

- Emit before any other side-effect (past-due carry-forward, HK hook, etc.) so it is always the first row.
- Guard: skip if a `booking_created` row already exists (idempotent for retried mutations).
- Backfill migration: for existing bookings without a `booking_created` activity, synthesize one at `created_at` using `created_by`, `source`, and current room assignments — non-editable by definition (activities are append-only).

---

## P1 — Due Collection UX

### UAT-026 — Copy Due Summary polish (`src/routes/_authenticated/dues.tsx`)

1. **Header**: derive title from active filter:
  - `all` → "Pending Dues (All Guests)"
  - `inhouse` → "Pending Dues from In-House Guests"
  - `today` → "Pending Dues from Today's Guests"
  - `future` → "Pending Dues from Future Guests"
2. **Placement**: move `Copy Due Summary` button into the toolbar row beside the Search input, right-aligned (`ml-auto`). Order: Filter chips → Search → Copy button.

Pure presentation change; no data logic touched.

---

## P2 — Laundry

### UAT-001 — Manual pickup (independent of HK Queue)

**Files**: `src/routes/_authenticated/laundry.tsx` (Pickup tab), `src/lib/laundry-batches-api.ts`.

1. Allow opening pickup composer when queue is empty.
2. "Add Manual Line" action → picks from `linen_types` master, quantity input, adds to draft with `qty_heos_queue = 0`, `qty_manual = n`.
3. Draft supports mixed queue + manual lines.
4. On confirm, all lines flatten into `laundry_batch_lines` with existing shape; only audit column differs (`qty_heos_queue`).

### UAT-002 — Manual lifecycle parity

Audit `laundry-batches-api.ts` (return, correct-return, short/damaged/lost, reporting reducers, monthly billing aggregator, CSV export) to confirm no `qty_heos_queue > 0` filter exists. Where found, remove it. Add a regression note in `docs/modules.md#laundry`.

---

## P3 — Navigation / Access / Reporting audits

### UAT-006 — HK Work History

Add "Work History" entry in Housekeeping sidebar group linking to `/reporting/housekeeping?tab=history` (or new sub-route if simpler). Gated on `reporting.housekeeping.view`.

### UAT-016 — Access Management audit

- Cross-reference every route in `src/routes/_authenticated/*` against `AppSidebar` and `permissions` seed.
- Ensure new routes (`/notifications`, `/operations/charge-catalog`) have permission gates.
- Remove obsolete keys (`operations.hk_issue_types`/`operations.linen_types` — verify still used).
- Update `docs/permissions.md` matrix.

### UAT-017 — Laundry Reporting audit

Walk `src/routes/_authenticated/reporting.laundry.tsx` + `lib/reporting/laundry-reporting.ts`. Reconcile Summary/Batch/Vendor totals against raw `laundry_batch_lines`. Add totals for outstanding/damaged/lost if missing. Verify CSV parity.

### UAT-018 — Monthly billing audit

Verify vendor billing aggregation groups by `vendor_id + month(picked_up_at)`, matches per-batch totals, and Vendor Statement PDF/CSV export reconciles. Document formula in `docs/modules.md#laundry-billing`.

---

## P3 — Mobile UX (UAT-023)

Final pass on operational modules at 360px viewport:

- Tables: ensure horizontal scroll or card fallback on `bookings`, `dues`, `laundry`, `housekeeping`.
- Popups: `luxe-card` `max-h-[90vh] overflow-y-auto` on all modals.
- Action buttons: min 44px tap target, prevent overflow with `flex-wrap`.
- Forms: single-column at `<sm` breakpoint.

Presentation-only; no logic changes.

---

## Deliverables

**New/edited files** (est.):

- `src/routes/api/public/razorpay-webhook.ts` — fee-as-charge split
- `src/lib/booking-create.ts` — audit trail first event
- `src/routes/_authenticated/dues.tsx` — header + placement
- `src/routes/_authenticated/laundry.tsx` — manual pickup UI
- `src/lib/laundry-batches-api.ts` — manual line support (if gaps found)
- `src/routes/_authenticated/master-data.tsx` — Payment Modes label
- `src/components/app-sidebar.tsx` — HK Work History link
- `src/routes/_authenticated/reporting.laundry.tsx` — reconciliation fixes (if any)
- Migration: seed `Razorpay Charges` in `charge_catalog`; backfill `booking_created` activities
- Docs: `permissions.md`, `modules.md`, `workflows.md`, `.lovable/backlog.md`

**Completion report** at end will include: root cause per UAT, files changed, arch decisions, regression impact, docs delta, backlog reconciliation, and any collateral fixes surfaced along the way.

---

Shall I proceed with implementation as described?

&nbsp;

&nbsp;

My response - 

Approved. The implementation plan looks good and aligns with the existing HEOS architecture. Please proceed as planned.

&nbsp;

I'd like to add one more operational finding to this shipment if possible.

&nbsp;

UAT-030 – Guest Portal URL Simplification & Performance

&nbsp;

Currently, Guest Portal URLs look like:

&nbsp;

[https://guest.hotelexcella.in/portal/b57ca77ac11bad16df1902c89bf85b83](https://guest.hotelexcella.in/portal/b57ca77ac11bad16df1902c89bf85b83)

&nbsp;

I'd prefer the public-facing URL to use the Booking Reference instead, for example:

&nbsp;

[https://guest.hotelexcella.in/portal/HEXB-FA5AE5](https://guest.hotelexcella.in/portal/HEXB-FA5AE5)

&nbsp;

The Booking Reference is unique, much easier for Reception staff to communicate over phone or WhatsApp, and greatly simplifies troubleshooting and guest support.

&nbsp;

If the existing token is still required internally, that's perfectly fine. Please retain the current internal routing or lookup mechanism if needed, but expose the Booking Reference as the public-facing URL so the guest sees a clean, human-friendly URL.

&nbsp;

Additionally, please perform a Guest Portal Performance Audit while implementing this.

&nbsp;

The Guest Portal should open as quickly as possible, as it will become one of the primary guest-facing entry points of HEOS.

&nbsp;

Please review and optimize where applicable:

&nbsp;

Database lookup strategy (ensure Booking Reference lookup is indexed if used).

&nbsp;

Backend/API response times.

&nbsp;

Number of backend requests made during initial page load.

&nbsp;

Frontend bundle size and lazy loading opportunities.

&nbsp;

React rendering and unnecessary re-renders.

&nbsp;

Images and static assets.

&nbsp;

Any avoidable loading delays.

&nbsp;

&nbsp;

If changing the URL from the current token to the Booking Reference introduces any measurable performance or architectural trade-offs, please explain them and implement the most efficient approach.

&nbsp;

Please also let me know the current Guest Portal performance metrics (initial page load/API timings) and any optimizations you make as part of this audit.

&nbsp;

The objective is to keep the Guest Portal simple, fast, and future-ready as we continue evolving HEOS toward Excella AI OS.

&nbsp;

&nbsp;

---

&nbsp;

Everything else in the proposed plan looks good. Please proceed with the implementation.