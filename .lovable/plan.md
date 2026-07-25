HEOS Phase 2 — Operational Room Model (Milestone Plan)

&nbsp;

Booking = commercial reservation. Booking Item = operational room. Occupancy segments remain the source of truth. Each milestone ships independently testable, with regression coverage before moving on.

&nbsp;

&nbsp;

&nbsp;

Milestone 0 — Occupancy engine finalization (foundation)

&nbsp;

Consolidate every room-move entry point onto one server-side path and add regression coverage before feature work continues.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

Single shared room-move API: moveBookingItemRoom({ item_id, new_room_id, effective_date }) in src/lib/booking-item-operations-api.ts, backed exclusively by the split_room_assignment RPC. Callers migrated:

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

House View drag-and-drop (src/routes/_authenticated/house-view.tsx)

&nbsp;

&nbsp;

&nbsp;

Booking Detail → Room Management Grid (src/routes/_authenticated/bookings_.$id.tsx)

&nbsp;

&nbsp;

&nbsp;

RoomAssignmentDialog (src/components/room-assignment-dialog.tsx)

&nbsp;

&nbsp;

&nbsp;

Any future screen (Room Management Grid, HK, etc.)

&nbsp;

&nbsp;

&nbsp;

No caller writes to booking_room_assignments directly for a move.

&nbsp;

&nbsp;

&nbsp;

Regression tests (Playwright + a lightweight SQL harness under tests/e2e/):

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

Repeated occupancy 102 → 104 → 102 — asserts 3 segments, no overlap, GiST constraint honored, historical rows unchanged (assert on id + start_date + ended_reason).

&nbsp;

&nbsp;

&nbsp;

Sibling rooms in a multi-room booking are not touched when one moves.

&nbsp;

&nbsp;

&nbsp;

Availability engine returns correct counts across the move window.

&nbsp;

&nbsp;

&nbsp;

HK: vacated room becomes Dirty; arrival room gets check-out task on due date.

&nbsp;

&nbsp;

&nbsp;

Night Audit run after moves closes cleanly; no orphaned segments.

&nbsp;

&nbsp;

&nbsp;

Per-item check-in/out survives an unrelated booking edit (guards the finding we just fixed).

&nbsp;

Docs: update docs/room-occupancy.md with the unified move contract.

&nbsp;

&nbsp;

&nbsp;

Milestone 1 — Operational Room fields & independent Check-In/Out

&nbsp;

Booking Item owns its operational identity.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

Schema (already partially in place — confirm/extend):

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

booking_items: assigned_room_id, primary_occupant_name, primary_phone, item_status, checked_in_at, checked_out_at, operational_notes (new, nullable text).

&nbsp;

&nbsp;

&nbsp;

booking_item_activities remains the per-item timeline table.

&nbsp;

&nbsp;

&nbsp;

Server functions in booking-item-operations-api.ts:

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

assignBookingItemRoom, checkInBookingItem, checkOutBookingItem, updateBookingItemOccupant({name, phone}).

&nbsp;

&nbsp;

&nbsp;

Each writes to booking_item_activities and fires HK hooks via existing hk-checkout-hook.

&nbsp;

&nbsp;

&nbsp;

UI: Room Management Grid on Booking Detail exposes Assign / Check-In / Check-Out / Edit Occupant per row. Booking-level Check-In/Out becomes a convenience that fans out to items still in Confirmed.

&nbsp;

&nbsp;

&nbsp;

Booking header status derived from item statuses (all Checked-In ⇒ Checked-In; all Checked-Out ⇒ Checked-Out; mixed ⇒ In-House).

&nbsp;

&nbsp;

&nbsp;

Milestone 2 — Add / Remove room during stay, partial arrivals & departures

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

Add Room During Stay: addBookingItemDuringStay({ booking_id, room_type, effective_date, occupant }) — new booking_items row with position appended, new segment starting at chosen Business Date (default today), never rewrites history. Pricing recalculated from segment nights only.

&nbsp;

&nbsp;

&nbsp;

Remove Individual Room: removeBookingItem(item_id) — if never checked in, cancel item + release future segment + free room; if checked in, route to existing check-out workflow. Other items untouched.

&nbsp;

&nbsp;

&nbsp;

Partial arrivals: check-in acts per item; remaining items stay Reserved.

&nbsp;

&nbsp;

&nbsp;

Partial departures: check-out acts per item; remaining items continue.

&nbsp;

&nbsp;

&nbsp;

Availability engine already segment-based — verify it observes new/removed items correctly.

&nbsp;

Regression: add cases to Milestone 0 suite.

&nbsp;

&nbsp;

&nbsp;

Milestone 3 — Room-specific charges & operational notes

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

booking_charges.item_id (already added) becomes first-class: charge form gets a "Attach to room" selector; defaults to booking-level (NULL) when unset.

&nbsp;

&nbsp;

&nbsp;

Invoice/Payments/Taxes/Guest Credit continue to aggregate at booking level — no split invoices yet.

&nbsp;

&nbsp;

&nbsp;

Views (in-house-charges-section.tsx, invoice dialog) group charges by item with a booking-level bucket for unattributed lines, laying the ground for future folios.

&nbsp;

&nbsp;

&nbsp;

Operational Notes: per-item free-text, edited from Room Management Grid, appears in item timeline.

&nbsp;

&nbsp;

&nbsp;

Milestone 4 — Search & activity timeline

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

Search bar on /bookings and global search matches on bookings.guest_name, phone, reference AND booking_items.primary_occupant_name, booking_items.primary_phone. Backed by a Postgres tsvector/trigram index (gin_trgm_ops) on both columns for speed.

&nbsp;

&nbsp;

&nbsp;

Per-item timeline component reused across Room Management Grid and Booking Detail — reads booking_item_activities + booking_charges scoped to item_id.

&nbsp;

&nbsp;

&nbsp;

Booking-level activity timeline continues to reflect commercial events (payments, invoice, cancellation, header edits).

&nbsp;

&nbsp;

&nbsp;

Milestone 5 — Regression suite, docs, review

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

Expand Playwright suite to cover: repeat occupancy, partial arrival/departure, add/remove room, availability, HK sync, Night Audit post-moves, Guest Portal parity (no per-item leakage to the guest view).

&nbsp;

&nbsp;

&nbsp;

Docs: refresh docs/room-occupancy.md, docs/booking-parity.md, docs/modules.md, add a Phase 2 section to docs/architecture.md.

&nbsp;

&nbsp;

&nbsp;

Final review checklist against HEOS principles (single source of truth, shared engines, history preservation).

&nbsp;

&nbsp;

&nbsp;

Technical section

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

Unified move contract: every caller uses moveBookingItemRoom(item_id, new_room_id, effective_date?). Internally: locate current active segment by item_id, invoke split_room_assignment(booking_id, old_assignment_id, new_room_id, effective_date). Response returns new segment id + updated item snapshot.

&nbsp;

&nbsp;

&nbsp;

Segment invariants (enforced in RPC, verified in tests):

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

GiST exclusion prevents overlap on (booking_id, room_id, daterange[start,end)).

&nbsp;

&nbsp;

&nbsp;

Segments with start_date < business_date are immutable.

&nbsp;

&nbsp;

&nbsp;

booking_items.assigned_room_id mirrors the current-day segment; NULL when none.

&nbsp;

&nbsp;

&nbsp;

Item status derivation: Confirmed → Checked-In → Checked-Out with Cancelled / No-Show terminal states. Booking status derived only when it changes, never overwriting a mixed state.

&nbsp;

&nbsp;

&nbsp;

Backfill RPC (backfill_booking_item_segment_links_for_booking) already scoped to a single booking; keep as the only reconciliation call on save.

&nbsp;

&nbsp;

&nbsp;

Charges attribution: booking_charges.item_id nullable → future folio work needs only a folio_id column, no restructure.

&nbsp;

&nbsp;

&nbsp;

Future-ready columns/tables (deferred, but reserved by naming): booking_item_occupants (many-to-one to item) for multi-occupant, booking_item_documents for ID verification, booking_item_keycards, booking_item_preferences. Not created now — noted so the shape stays additive.

&nbsp;

&nbsp;

&nbsp;

Test harness: Playwright drives the UI paths; a small Node script hits Supabase via service role for direct SQL assertions on booking_room_assignments / booking_items state after each scenario.

&nbsp;

Out of scope for this plan

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

Split billing / per-room folios (schema-ready, UI later).

&nbsp;

&nbsp;

&nbsp;

Maintenance module rewrite.

&nbsp;

&nbsp;

&nbsp;

Reporting changes beyond what is needed to keep existing reports correct.

&nbsp;

&nbsp;

&nbsp;

Please confirm this milestone sequence (or point out reordering) and I'll start with Milestone 0 — unifying room-move callers and landing the repeat-occupancy regression suite.

&nbsp;

&nbsp;

My comments - 

Thank you. Overall, I agree with the proposed milestone sequence. The progression from stabilising the occupancy engine to introducing the operational room model is logical and should minimise regression risk.

I have a few refinements and confirmations before we begin.

Milestone Sequence

The proposed order looks appropriate:

Milestone 0 – Occupancy Engine Finalisation

Milestone 1 – Operational Room Identity

Milestone 2 – Add/Remove Room & Partial Operations

Milestone 3 – Room-specific Charges & Notes

Milestone 4 – Search & Activity Timeline

Milestone 5 – Regression, Documentation & Final Review

Please continue delivering these as independently verifiable milestones.

Milestone 0

I fully agree.

This milestone is about stabilising the occupancy engine.

Every room movement should continue flowing through the same shared server-side API.

The automated regression suite around repeated occupancy (102 → 104 → 102) is especially important and should become a permanent part of HEOS.

Please also include regression scenarios covering:

102 → 104 → 105 → 102

Multi-room booking where only one room moves

Move back to previously occupied room

Same booking edited after room move

Night Audit after multiple room moves

Milestone 1

I agree with the operational room model.

However, I would request one additional field.

Each operational room should also have:

Operational Notes

Reception frequently records room-specific instructions which should not belong to the booking.

Milestone 2

I agree with Add Room / Remove Room.

One clarification:

When adding a room during a stay:

Example

21 Jul → 25 Jul

2 Rooms

On 23 Jul

Reception adds another room.

The pricing engine should charge only from the effective start date of the new Booking Item.

Historical nights before the new room existed must never be billed.

Likewise, when removing a future room before arrival, pricing should automatically recalculate only for that Booking Item without affecting the remaining rooms.

Milestone 3

I fully agree with room-specific charges.

One small refinement:

When posting a charge, Reception should be able to choose:

Booking

Specific Room

This should default intelligently:

If working from a room context → default to that room.

If working from booking-level charges → default to booking.

This will make the workflow much faster.

Milestone 4

Search by both Booking Holder and Primary Occupant is exactly what Reception needs.

I also suggest allowing search by:

Assigned Room Number

This is useful when staff know only the room number.

Milestone 5

I agree.

Please also include one final architecture review ensuring:

No duplicate occupancy logic remains.

No duplicate availability logic remains.

No direct writes bypass the operational room APIs.

No reports bypass occupancy segments.

One Additional Architectural Recommendation

As Phase 2 introduces Booking Items as operational entities, I recommend treating them as the only owner of room operations.

Operational Room should become responsible for:

Assignment

Occupancy

Primary Occupant

Charges

Housekeeping

Activity

Notes

The Booking should remain responsible only for:

Reservation

Commercial information

Payments

Invoice

Taxes

Discounts

Guest Credit

Booking Holder

This separation should remain strict going forward.

One Future Enhancement (Not part of this milestone)

Please keep the design compatible with future room-level capabilities without implementing them now.

Examples:

Multiple occupants

ID verification

Key cards

Guest preferences

Split billing

Room folios

The schema already appears to be heading in this direction, which is appreciated.

Regression Requirement

After every milestone, please pause for UAT before beginning the next milestone.

We would prefer:

Milestone → Verification → Milestone → Verification

rather than implementing multiple milestones together.

This will make regression detection much easier and allow us to validate each architectural layer independently.

Final Confirmation

Other than the refinements above, I agree with the proposed roadmap and recommend proceeding with Milestone 0 first.

The occupancy engine is now one of the core foundations of HEOS, so taking a milestone-by-milestone approach with automated regression testing and UAT verification is the right balance between stability and continued development.

&nbsp;

Also, From this point onward, I'd also ask you to include a brief "what changed" summary with each milestone. For every milestone completion, you should tell me:

Database changes (tables, columns, constraints, migrations).

New or modified APIs/RPCs.

Affected UI screens.

Regression tests added.

Manual test scenarios they executed.

Known limitations or deferred items.

That will make each milestone much easier to review and will give you a clear implementation history as HEOS matures. I think it will save me considerable time during future UAT cycles.