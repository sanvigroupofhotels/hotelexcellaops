## HEOS Core v1.1 — Stabilization Sprint 5 Plan

### P0 — Finance & Booking

**UAT-028 · Payment Modes SoT (root cause found)**  
`master_data.payment_method` has rows whose `label` was edited (e.g. "FabHotels", "Guest Portal") but `value` was left stale ("Other", "Bank Transfer"). `useMasterData()` returns `values`, so the Add Payment modal shows stale values, not the admin-edited labels.  
Fix:

- Change `AddBookingPaymentModal` and every other Add-Payment surface (cancel/refund dialog, cash book, portal, booking engine review) to render **labels** and persist labels as the free-text mode string.
- Also expose `useMasterData(...).labels` list directly for these dropdowns.
- Add a `payment-modes` helper hook (`usePaymentModes()`) that returns `{ modes: string[] }` (labels, sorted, active) with a defensive fallback — so every dropdown pulls from one place. Replace all hard-coded `PAYMENT_MODES` UI usages with it. Storage constants stay for legacy/webhook code.

**UAT-032 · In-house Charges show Date + Time**  
`in-house-charges-section.tsx` line 81 uses `toLocaleDateString`. Switch to the same formatter used by Payments (date + time, `en-IN`, `dd Mon · hh:mm AM/PM`). Apply anywhere charges are listed (booking detail, House View popup summary, cancel/refund preview, activity log summary line).

**UAT-034 · Refund Financial Recalculation**  
Audit every mutation path and ensure `refreshAfterBookingMutation(qc, bookingId)` (which awaits `recomputeBookingAmount` and invalidates every dependent cache) is called immediately after:

- Payment create/edit/delete
- Refund create (cancel dialog + explicit refund)
- In-house Charge create/edit/delete
- Razorpay webhook auto-charge (server side: also emit the same booking-level recalc via `recomputeBookingAmount` since QueryClient isn't available server-side — client cache refresh happens on refocus / realtime)
- Discount/waiver/total-override save (Edit Booking already does this; verify)
- Past-due carry forward (night audit)
- Cash refund from cashbook

Confirm the reconciliation identity in one place (`booking-totals.ts` helper if not already centralized):  
`Balance Due = Room+Stay + In-house Charges − Discounts − Waivers − (Payments − Refunds)`

### P1 — Verification Only (no code changes unless defects found)

UAT-001, 002, 025 — spot check via read_query + code trace; document in backlog.

### P2 — Deferred Audits (documentation)

- UAT-006 — Add rationale note in `navigation.md`.
- UAT-016 — Audit routes vs sidebar vs `permissions.md`; remove obsolete keys; regenerate table.
- UAT-017/018 — Reconcile laundry reports to `laundry_batch_lines`; add formula section in `modules.md`.
- UAT-023 — Mobile pass — touch targets ≥44px, table→card fallback verification at 360px. Presentation-only tweaks where obvious.

### New — UAT-033 · Multiple Contact Numbers

**Schema (new migration)**

```
customer_phones (
  id uuid pk,
  customer_id uuid fk → customers,
  user_id uuid,           -- tenant scope
  phone text not null,    -- normalized E.164-ish (reuses phone.ts)
  is_primary boolean not null default false,
  label text,             -- optional: "Personal", "Work"
  created_at, updated_at
)
```

- Unique index `(phone) where phone is not null` — cross-customer duplicates blocked.
- Partial unique index: one primary per customer.
- Backfill: `INSERT ... SELECT customer_id, user_id, phone, true FROM customers WHERE phone IS NOT NULL`.
- Keep `customers.phone` populated with the primary for zero-regression reads (trigger keeps it in sync).
- RLS: mirrors `customers` (`user_id = auth.uid()` + admin bypass).
- GRANTs for authenticated + service_role.

**API (**`src/lib/customer-phones-api.ts`**)**

- `listCustomerPhones(customerId)`, `addCustomerPhone`, `updateCustomerPhone`, `deleteCustomerPhone`, `promoteCustomerPhone`.
- Extend `findCustomerByContact()` to search `customer_phones` (union).
- Extend `searchCustomers()` to include phone rows.
- All existing `customers.phone` reads keep working (primary is mirrored).

**UI**

- `customer-edit-dialog.tsx` — Contact section becomes a list: primary badge, add/edit/delete, promote-to-primary.
- Customer detail page mirrors the list.
- Duplicate-phone error: same "customer already exists — search and use existing record" message.

### Files to change

- `src/lib/booking-payments-api.ts` (label-safe fallback list; already correct)
- `src/hooks/use-payment-modes.ts` (new)
- `src/components/add-booking-payment-modal.tsx`
- `src/components/in-house-charges-section.tsx`
- `src/routes/_authenticated/bookings_.$id.tsx` (refund/cancel refresh call)
- `src/routes/_authenticated/cash.tsx` (payment mode dropdown, cash refund refresh)
- `src/routes/portal.$token.tsx` + booking-engine review (payment mode dropdowns)
- `src/lib/booking-pricing-sync.ts` (no code change; verify call sites)
- New migration: `customer_phones` table + backfill + triggers
- `src/lib/customer-phones-api.ts` (new)
- `src/lib/customers-api.ts` (extend search)
- `src/components/customer-edit-dialog.tsx`, `src/routes/_authenticated/customers_.$id.tsx`
- Docs: `docs/permissions.md`, `docs/modules.md`, `docs/navigation.md`, `.lovable/backlog.md`

### Regression impact

- Payment-mode display now shows labels instead of internal values. `booking_payments.payment_mode` retains whatever string it currently holds (both readable). No breaking read.
- `customers.phone` remains authoritative for primary; existing queries unaffected. Only extra join for full-list surfaces.
- Refund recalc uses the existing shared engine — no new business logic.

### Out of scope (explicit)

- UAT-007, UAT-009 (excluded by user).
- Repricing historical bookings retroactively; the recalc is per-mutation only.

Confirm to proceed.

My response - 

UAT-028 – Payment Modes

The proposed approach looks good.

Please ensure that every payment mode dropdown across the application (Add Payment, Refunds, Cash Book, Guest Portal, Booking Engine, etc.) reads from the same shared source. There should never be any possibility of different payment mode lists appearing in different modules.

UAT-032 – In-house Charges Timestamp

Please use exactly the same date/time formatter as the Payments section so the entire booking timeline remains visually consistent.

UAT-034 – Financial Reconciliation

While implementing, please also verify that every financial mutation flows through the shared recalculation engine, including:

Payments

Refunds

In-house Charges

Charge edits/deletes

Razorpay auto charges

Past Due carry forward

Discounts / Waivers

Any future system-generated financial adjustments

The booking ledger should always remain internally consistent.

UAT-033 – Multiple Contact Numbers

The proposed design looks good.

Please also ensure:

One customer represents one real person.

A customer may have multiple contact numbers.

One number is always marked as Primary.

Searching with any registered mobile number returns the same customer profile and booking history.

Duplicate phone numbers across different customers must not be allowed.

This design will support future CRM and Excella AI OS capabilities.

Everything else looks good. Please proceed with the implementation.

&nbsp;