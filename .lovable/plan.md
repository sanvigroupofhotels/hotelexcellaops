## HEOS Core v1.1 — Stabilization Sprint 4 Plan

### P0 · Finance & Payments

**UAT-025 · Razorpay Convenience Fee — Verification + polish**
Fee split is already implemented in `src/routes/api/public/razorpay-webhook.ts` (lines 202–260): when captured > outstanding, it creates a `booking_charge` with `category='Razorpay Charges'`, records an offset payment, and logs `razorpay_fee_adjustment` in `booking_activities`. It IS visible under Booking → Charges.
Actions:

- Add a `system_generated: true` marker in the charge `notes`/metadata field so it's identifiable as auto-generated (already in activity metadata, extend to charge).
- Add a small "Verify" note in the completion report showing where in the UI the guest can see it: `Booking Detail → Charges section` (rendered by `in-house-charges-section.tsx`).
- Simulate a live webhook via `supabase--read_query` on `booking_charges` for recent Razorpay-Charges rows and share the query snippet in the report.

**UAT-026 · Copy Due Summary right-align**
`dues.tsx` — wrap toolbar with `flex items-center gap-2 w-full`, add `ml-auto` to Copy Due Summary button so it hugs the right edge next to search input.

**UAT-028 · Payment Modes SoT — expose in Master Data UI**
`master-data.tsx` — confirm the Finance group has a `payment_method` tab labelled "Payment Modes"; if missing, add it. Seed default modes on empty. Document in `docs/modules.md`.

### P1 · Cash Book

**UAT-031 · Cash Out Bill Attachment** (new)
Schema:

- New table `cash_tx_attachments` (id, tx_id fk, user_id, storage_path, mime_type, file_size, uploaded_by, uploaded_by_name, created_at). RLS: same visibility as parent tx.
- New storage bucket `cash-tx-attachments` (private) with owner-based RLS.
- Activity: extend `cash_tx_activities` action enum to include `attachment_added`, `attachment_replaced`, `attachment_deleted`.

API (`src/lib/cash-api.ts`): add `listCashTxAttachments`, `uploadCashTxAttachment`, `deleteCashTxAttachment`, `signedCashTxAttachmentUrl`. Log activities.

UI:

- Add-Cash-Tx modal (find the current cash-out entry point — `cash.tsx`): file picker (image/pdf, multi), preview, delete.
- Mandatory rule: FO staff + kind='expense' + amount > 300 ⇒ at least one attachment required before save. Owner/Admin bypass via `has_role('admin'|'owner')` check.
- Detail/edit view: list attachments with View / Replace / Remove buttons (mirrors `add-booking-payment-modal.tsx` attachment block).

### P2 · Laundry

**UAT-001 · Manual Laundry Pickup (from empty queue)**
`laundry.tsx` Pickup composer:

- Remove `queue.length === 0` blocker (already partially done per Sprint 3 backlog note — confirm).
- Add "+ Add Manual Line" button that opens a linen-type picker fed by `linen_types` master (`listLinenTypes`).
- Manual line: `qty_heos_queue = 0`, `qty_manual = n`, `linen_type_id`, `linen_type_name`.
- Mixed pickup: queue rows + manual rows coexist in draft.
- On confirm, flatten to `laundry_batch_lines` (same shape).

**UAT-002 · Manual Laundry Lifecycle parity**
Audit `laundry-batches-api.ts` and `laundry-queue-api.ts` for any `qty_heos_queue > 0` filter and remove. Verify reporting/billing/CSV pull from `laundry_batch_lines` regardless of origin. Document parity in `docs/modules.md`.

### P3 · Audits (documentation-only sprint tasks)

**UAT-006 · Work History Nav** — Document rationale in `docs/navigation.md`: sidebar shortcut deep-links to `/reporting/housekeeping`, keeping HK Reports as SoT. Rationale: avoids duplicating report logic; permission-gated on `reporting.housekeeping.view`.

**UAT-016 · Access Management audit** — Enumerate all routes vs `AppSidebar` permissions vs `permissions` table. Remove obsolete keys. Update `docs/permissions.md` with a full route-to-permission matrix.

**UAT-017 · Laundry Reporting reconciliation** — Walk `reporting.laundry.tsx` + `lib/reporting/laundry-reporting.ts`. Verify Summary, Batch Details, Vendor Reports, CSV, Outstanding, Damaged, Lost totals all sum from raw `laundry_batch_lines`. Document formulas.

**UAT-018 · Monthly Billing audit** — Verify vendor aggregation groups by `vendor_id + month(picked_up_at)`, per-batch totals × unit price, CSV/PDF parity. Document calculation formula in `docs/modules.md` under Laundry.

**UAT-023 · Mobile UX final pass** — Sweep operational modules at 360px: tables get `overflow-x-auto`, modals use `luxe-card` full-height on small screens, buttons ≥44px tap targets, forms single-column below `sm`. Presentation-only.

### Files Changed (planned)

- `src/routes/api/public/razorpay-webhook.ts` (annotate)
- `src/routes/_authenticated/dues.tsx` (right-align)
- `src/routes/_authenticated/master-data.tsx` (payment_method tab confirm)
- `src/routes/_authenticated/cash.tsx` (attachment UI + mandatory rule)
- `src/lib/cash-api.ts` (attachment API)
- `src/routes/_authenticated/laundry.tsx` (manual pickup)
- `src/lib/laundry-batches-api.ts`, `src/lib/laundry-queue-api.ts` (parity audit)
- New migration: `cash_tx_attachments` table + storage bucket + policies + activity enum
- Docs: `permissions.md`, `modules.md`, `navigation.md`, `.lovable/backlog.md`

### Regression Impact

- Razorpay: no logic change, only note enrichment — zero risk.
- Cash attachments: additive tables/bucket; the mandatory-rule enforcement is client-side + server RLS check; existing cash-out flow unaffected without attachments.
- Laundry manual pickup: purely additive draft-composer feature; existing queue pickups untouched.
- Access/reporting/mobile audits: doc-only + presentation-only.

### Approval

This is a large multi-file sprint including a new DB table + storage bucket. Please approve before I begin the migration and file edits.

**My response -** 

&nbsp;

I think the plan is good overall. I would only leave a few concise comments before approving.

---

**Approved. The plan looks good and aligns with the HEOS architecture. Please proceed with the implementation.**

A few comments/clarifications before you begin:

### 1. UAT-025 – Razorpay Charges

Please don't just verify the implementation.

Kindly ensure that the automatically created **"Razorpay Charges"** entry is clearly visible under **Booking → Charges** and is easily distinguishable as a **system-generated** charge. The corresponding Activity History should clearly link the payment and the automatically generated charge.

---

### 2. UAT-028 – Payment Modes

If the actual master category is internally named `payment_method` for backward compatibility, that's perfectly fine.

However, from an administrator's perspective, the Master Data UI should consistently present it as **Payment Modes**. There should be no confusion between **Payment Method** and **Payment Mode** anywhere in the application or documentation.

---

### 3. UAT-031 – Cash Book Attachments

The proposed implementation looks good.

Please also ensure:

- Attachments are visible from the Cash Book transaction detail page.
- Images can be viewed in a full-screen/lightbox viewer.
- PDFs can be opened/downloaded.
- Multiple attachments are supported.
- All attachment operations (add/replace/delete) are captured in the Activity History.

---

### 4. UAT-001 / UAT-002 – Laundry

Please test the complete lifecycle of manually added linen yourselves before considering this complete.

Manual linen should behave **identically** to queue-generated linen across every downstream workflow. There should never be any operational distinction after the batch has been created.

---

### 5. Performance

While working on these changes, if you notice any unnecessary queries, duplicate rendering, or opportunities to improve responsiveness, please optimize them as part of this sprint. Small performance improvements are always welcome where they don't affect architecture.

---

Everything else looks good. Please proceed with the implementation.