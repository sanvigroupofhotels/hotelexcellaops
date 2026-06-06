# True Quote ↔ Booking Form Parity (Shared Components)

## 1. Why the forms are still different today

Quote forms and Booking forms were built at different times and have never shared section-level components. Each form independently renders its own JSX for Guest, Stay, Rooms, Extras, etc.

Concretely:

- **New/Edit Quote** has a *primary* room rendered as form fields (`room_type`, `rooms`, `extra_bed`, `PolicyFields`) inside a dedicated **"Room & Extras"** card, with `LineItemsEditor` used only for *additional* split-stay rooms. It also has an **"Additional"** card with Discount + Internal Notes.
- **New Booking** treats every stay as a line item (`LineItemsEditor` only, starting at index 1). It has no "Room & Extras" card and no "Additional" card; Internal Notes lives inside "Booking & Payment", and there is no Discount field at all.
- **Edit Booking** is even thinner: one combined "Stay Items" card and a Payment card.
- Section labels, ordering, and the Split-Stay control all diverge.

The previous parity round only normalized labels ("Special Requests…", section reorder) and shared the read-only `StayItemsList`. The editing surface was never unified.

## 2. What remains to be done

Achieve true four-screen parity by introducing one shared editing component used by all four routes.

### New shared component: `src/components/shared/stay-form-sections.tsx`

Responsible for rendering, in this exact order, identically across all four screens:

```
1. Guest Details              (name, phone, email, lead source, group size)
2. Stay Details               (check-in / check-out dates, nights readout)
3. Room & Extras              (primary room: type, rooms, extra bed, breakfast,
                               early/late check-in/out, pet, extra adults, drivers)
4. Additional Rooms / Split Stay  (LineItemsEditor for index >= 1)
5. Additional                 (Discount, Internal Notes)
```

Props (controlled component):

```
value: SharedStayValue            // unified shape, see below
onChange: (v: SharedStayValue) => void
customerSlot?: ReactNode          // host-supplied (existing-customer banner / autocomplete)
mode: "quote" | "booking"         // only used to toggle very minor copy
```

Unified shape (in-memory, not a DB shape):

```
SharedStayValue = {
  guest: { guest_name, phone, email, lead_source, group_size, adults, children, guests }
  dates: { check_in, check_out }
  primary: LineItem               // mirrors the first stay item
  extras: LineItem[]              // additional rooms / split stay
  discount: number
  internal_notes: string
  special_requests: string
}
```

`primary` reuses the existing `LineItem` type so we can render it with the same row UI used in `LineItemsEditor` (extracted into a reusable `<LineItemFields>` cell). This is what makes the four screens *behaviorally* identical, not just visually.

### Host pages keep only what's unique to them

Each route becomes a thin shell that:

- mounts `<StayFormSections />`
- adds its module-specific sections **below**:
  - **Quote (new + edit):** Quote Status, Booking Probability, Lost Reason, "Convert to Booking" action (on the detail page, not the form).
  - **Booking (new + edit):** Total Amount (auto = stay total - discount), Advance Paid, Payment Method, Balance, Booking Status, Booking communication actions.

Allowed differences match exactly the list you specified.

### Mapping shared shape ↔ persistence

No schema changes are required for *visual* parity. Persistence stays as-is:

- **Quote save**: `primary` fields are flattened back into `quotes` columns (`room_type`, `rooms`, `extra_bed`, `early_check_in_*`, `late_check_out_*`, `pet_size`, `extra_adults`, `drivers`, `breakfast_included`, `discount`, `internal_notes`). `[primary, ...extras]` is written to `quote_items` via `replaceQuoteItems` (unchanged behavior — position 0 = primary).
- **Booking save**: `[primary, ...extras]` is written to `booking_items` exactly as today. `discount` and `internal_notes` are persisted on the `bookings` row — see section 3.

## 3. Is a schema migration required?

**Mostly no — this is a UI/component issue.** One small additive migration is the only DB change needed, and only to honor the Discount field on bookings:

- Add `bookings.discount numeric default 0`
- Add `bookings.special_requests text` *(optional — today reuses `notes`; we can keep `notes` and just rename the label, no migration needed)*

`internal_notes` already exists on bookings. Everything else (early/late check-in/out, pet, extra adults, drivers, multiple rooms) is already represented at the item level in `booking_items`, so no per-item migration is needed.

If you'd rather avoid even the discount column for now, the alternative is to store discount as a negative-value line item on the booking — operationally messier and harder to audit. I recommend the additive column.

## 4. Implementation steps

1. Add `bookings.discount` column (single additive migration, default 0, nullable safe).
2. Extract `<LineItemFields>` from `line-items-editor.tsx` (pure presentational; the existing `LineItemRow` keeps using it). No behavior change to existing callers.
3. Create `src/components/shared/stay-form-sections.tsx` rendering the 5-section layout above using `<LineItemFields>` for the primary room and `<LineItemsEditor>` for extras.
4. Refactor `routes/_authenticated/generate.tsx` (New Quote) and `quote.$id_.edit.tsx` (Edit Quote) to consume the shared component. Quote-only sections (status / probability / lost reason / convert action where relevant) stay below.
5. Refactor `routes/_authenticated/bookings_.new.tsx` and `bookings_.$id_.edit.tsx` to consume the shared component. Booking-only Payment section (Total / Advance / Method / Balance) stays below; Booking Status moves into Payment header to match Quote Status placement.
6. Keep totals/summary cards (`LiveSummaryCard` for quote, custom summary for booking) — only the editing body is shared; right-rail summary may legitimately differ because Quote shows taxes/discount preview and Booking shows balance/advance.
7. Regression-check: convert-quote-to-booking prefill, existing-customer banner, customer autocomplete, cash-collection prompt on advance, audit triggers.

## 5. Out of scope (deliberately)

- Restructuring `quotes` to use only `quote_items` (would be option (a) — explicitly rejected last round).
- Changing the right-rail Summary cards' content.
- Touching detail/view pages — they already share `StayItemsList`.

## 6. Decision needed before I implement

Confirm one item:

- **OK to add `bookings.discount numeric default 0`** as a single additive migration so the Discount field works identically on Booking forms? (Recommended.)

On confirmation I'll execute steps 1–7 in one pass. Approximate diff size: ~1 new component (~250 lines), 4 route files slimmed by ~30–40% each, 1 small migration.
