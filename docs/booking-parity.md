# Booking Parity Audit — Quick vs Detailed

_Last updated: 2026-07-05 (post P1 Quick Booking Pricing Parity sprint)_

Purpose: single reference documenting field-by-field parity between
`bookings_.quick.tsx` (Quick Booking) and `bookings_.new.tsx` (Detailed
Booking). Any intentional divergence is captured with a reason.

## Shared engines (single source of truth — reused by both flows)

| Engine | Module | Usage |
|--------|--------|-------|
| Pricing | `@/lib/pricing` (`computePricing`, `DEFAULT_TAX_RATE`) | Subtotal, taxes, discount, override (gross/net) math |
| Pricing UI | `@/components/pricing-breakdown` (`PricingBreakdownCard`) | Editable override + Taxes-Included toggle |
| Rates | `@/hooks/use-resolved-rate` | Override → weekend/weekday → default |
| Inventory | `@/lib/room-inventory` (`useRoomTypeAvailability`, `maxSelectableRooms`) | Live availability clamp |
| Customer resolution | `@/lib/customer-resolution` | Existing-customer detection |
| Booking creation | `@/lib/booking-create` (`submitNewBooking`) | Customer link / advance / notifications |
| Booking update | `updateBooking` + `updateBookingStay` + `replaceBookingItems` | Unified edit pipeline |
| Payments UI | `@/components/payment-settings-section` (`PaymentSettingsSection`) | Per-booking payment flag overrides |
| Master data | `@/hooks/use-master-data` | Lead sources |

## Field / behaviour parity matrix

| Field / behaviour | Detailed | Quick | Status |
|-------------------|----------|-------|--------|
| Guest name / phone / email | ✅ | ✅ | Parity |
| Check-in / Check-out | ✅ | ✅ | Parity |
| Adults / Children | ✅ | ✅ | Parity |
| Room type selection | Free (StayFormSections) | Fixed to Oak + Mapple (property inventory) | **Intentional** — Quick is speed-optimized for the two-room-type property |
| Room count / inventory clamp | ✅ | ✅ | Parity — same `maxSelectableRooms` |
| Rate resolution | `useResolvedRate` | `useResolvedRate` | Parity |
| Discount (₹) | ✅ | ✅ | Parity |
| Other charges (line item) | Via extras editor | Single "Other Charges" input | **Intentional** — one bucket for Reception speed; still flows through `computePricing` and persists as a `booking_charges` row |
| **Total Override — value type** | `number \| null` | `number \| null` | Parity (was `string` before P1 sprint) |
| **Total Override — Taxes Included toggle** | User-toggleable checkbox | User-toggleable checkbox | Parity (was hardcoded `true` before P1 sprint) |
| **Total Override — UI** | Editable Final Amount on `PricingBreakdownCard` | Editable Final Amount on `PricingBreakdownCard` | Parity — same component, same editable mode |
| Override → Discount auto-derive (when override < computed) | ✅ | ✅ | Parity (shared engine) |
| Override → Room Charges bump (when override > computed) | ✅ | ✅ | Parity (shared engine) |
| Reset override → computed | ✅ | ✅ | Parity (via shared component) |
| Advance payment amount + mode | ✅ | ✅ | Parity |
| Lead source | ✅ (master-data dropdown) | ✅ (master-data dropdown, in "More Options") | Parity |
| Special requests (guest-facing) | ✅ | ✅ (in "More Options") | Parity |
| Internal notes | ✅ | ✅ (in "More Options") | Parity |
| Per-booking payment flags (`PaymentSettingsSection`) | ✅ | ✅ (in "More Options") | Parity |
| Extras (Early CI / Late CO / Pet / Extra Adult / Driver / Extra Bed / Breakfast) | ✅ | ❌ | **Intentional** — Quick is speed-optimized. Add extras from booking detail after create |
| Additional Rooms / Split Stay | ✅ | ❌ | **Intentional** — same reason. Detail screen owns edits |
| Convert-from-Quote prefill | ✅ | ❌ | **Intentional** — Quick has no `?fromQuoteId` entry point |
| Prefill from calendar/House View (`?roomId`, `?checkIn`) | ✅ | ❌ | **Intentional** — Quick opens blank |
| Existing-customer detection | phone + email + name | phone only | **Intentional** — Quick's UX is phone-first; matches actual Reception workflow |
| Customer force-new toggle | ✅ | Not exposed | **Intentional** — Quick auto-links by phone; if no match, a new customer is created |
| Room assignment (`room_id`) | Prefill only | Not set | **Intentional** — both flows defer to Check-in / House View |

## Post-P1 verification checklist

- [x] Both forms use `computePricing` with `{ totalOverride, taxesIncluded }`.
- [x] Both persist `total_override` + `taxes_included` on the booking row.
- [x] Both flow through `submitNewBooking` → `bookings-api` → `booking-items-api` → `booking-payments-api`.
- [x] Both reuse `PricingBreakdownCard` for the Final Amount + editable override + Taxes Included checkbox.
- [x] Both reuse `PaymentSettingsSection` for per-booking payment flag overrides.
- [x] Both read `lead_source` options from Master Data via `useMasterData`.
- [x] Quick's Edit-Mode uses the same `updateBooking` + `updateBookingStay` + `replaceBookingItems` pipeline as Detailed's edit route.
- [x] Typecheck passes (`bunx tsgo --noEmit`).

## Intentional divergences summary

1. **Room type scope** — Quick shows only Oak + Mapple (the property's real inventory). Detailed keeps the freeform StayFormSections API for future room types.
2. **Extras / Split stay** — Kept off Quick to preserve <30s data-entry target. Add via booking detail after creation — no data-model divergence.
3. **Customer matching** — Quick is phone-first (Reception mental model). Detailed's `phone + email + name` search is retained for Convert-from-Quote flows where the phone may not yet exist.

Any future common feature added to Detailed must be evaluated against this
matrix. Divergences require an entry above with reasoning.
