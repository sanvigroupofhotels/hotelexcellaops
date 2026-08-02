# Shared Search & Clone Booking Services

Two shared Reception services. No module may re-implement either.

## Shared Search Service — `src/lib/booking-search.ts`

`searchBookings(query, { limit, includeCancelled })` resolves a booking across
every searchable dimension and returns enriched, de-duplicated results:

| Dimension          | Source of truth                                        |
| ------------------ | ------------------------------------------------------ |
| Booking Holder     | `bookings.guest_name`                                  |
| Primary Occupant   | `booking_items.primary_occupant_name` (non-Removed)    |
| Mobile Number      | `bookings.phone` (digits-insensitive)                  |
| Booking Reference  | `bookings.booking_reference`                           |
| Assigned Room No.  | `booking_room_assignments` → `rooms.room_number`       |
| Company / Group    | `customers.company_name`                               |

`matchesBookingSearch(query, candidate)` is the pure predicate for modules that
already hold booking rows in memory — same semantics, no round-trip. Cancelled
and No-Show bookings are hidden unless `includeCancelled` is set.

Consumers pick the behaviour; the service never navigates. House View uses it
purely for navigation: selecting a result opens `/bookings/$id`.

## Shared Clone Booking Service — `src/lib/booking-clone.ts`

`buildBookingClonePrefill(bookingId)` returns the commercial shape of a booking
as a prefill for the ordinary new-booking flow (`/bookings/new?fromBookingId=…`),
so the shared pricing and availability engines are the ones that validate the
clone. `applyClonedOccupants(bookingId, occupants)` copies Primary Occupant
names onto the new operational rooms by position after save.

**Copied**: booking holder, contact details, company / corporate link (via the
customer), room types, number of rooms, adults / children, rate plan and nightly
rates, extras (breakfast, extra bed, early CI / late CO, pets, drivers), special
requests, booking notes, primary occupants.

**Never copied**: payments, charges, guest credit, invoice, booking status,
check-in / check-out state, assigned rooms, occupancy segments, housekeeping
tasks, activity timeline, room moves, documents, key cards.

## Regression coverage

- `tests/booking-search.test.ts` — matcher semantics for all six dimensions.
- `tests/e2e/room-move-regression.spec.py` — operational room lifecycle.
