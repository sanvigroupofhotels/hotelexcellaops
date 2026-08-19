/**
 * HOUSE VIEW PLACEMENT ENGINE (pure).
 *
 * Turns bookings + booking_items + booking_room_assignments into the visual
 * lanes House View renders. It is a *representation* layer only:
 *
 *  - It never writes. Nothing here creates or implies a room assignment.
 *  - It never invents a second occupancy model. Occupancy always comes from
 *    `booking_room_assignments` segments via `pairStaySlotsToRooms`
 *    (see docs/room-occupancy.md).
 *  - Availability decisions stay in `src/lib/availability.ts`; this module only
 *    decides which lane a chip is drawn in.
 *
 * Same-day turnover (UAT-053): a room can be occupied by booking A until its
 * checkout date and by booking B from that same date onward. Segments are
 * half-open `[start, end)`, so those two do NOT overlap and BOTH chips are
 * rendered on the room row, tagged `_turnoverDeparture` / `_turnoverArrival`.
 * A departed booking is never hidden or replaced by the arriving one.
 *
 * Unassigned arrivals: when no clean lane exists (e.g. every room of the type
 * is occupied overnight and only frees up later today), the slot is returned as
 * a `pendingArrival` with the rooms that are expected to free up through
 * checkout. Reception still has to assign a room — `assigned_room_id` stays
 * NULL.
 */
import {
  pairStaySlotsToRooms,
  segmentOverlapsRange,
  segmentsOverlap,
  slotEndExclusive,
  stayRoomTypesMatch,
  type StayAssignmentLike,
  type StayItemLike,
  type StayRoomLike,
  type StaySlot,
} from "./stay-segments";

/** Statuses where the guest has physically left the room. */
export const DEPARTED_STATUSES = new Set(["Checked-Out", "Stay Completed"]);

export function isDepartedStatus(status?: string | null) {
  return DEPARTED_STATUSES.has(String(status ?? ""));
}

/**
 * Departure state of a single rendered chip — ITEM level first.
 * A multi-room booking can have one room departed while others are in-house,
 * so the item's own status wins; the parent status is only the fallback.
 */
export function isChipDeparted(
  chip: { status?: string | null; _itemStatus?: string | null; _itemCheckedOutAt?: string | null },
) {
  return isDepartedStatus(chip._itemStatus) || !!chip._itemCheckedOutAt || isDepartedStatus(chip.status);
}

export function nextDay(ymd: string) {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface PlacedChip {
  id: string;
  status?: string | null;
  room_id: string;
  check_in: string;
  check_out: string;
  _slotKey?: string;
  _virtual?: boolean;
  _historical?: boolean;
  /** Drawing shortened to avoid overlapping a live booking; data untouched. */
  _displayClamped?: boolean;

  /** Per-item operational status behind this chip (multi-room bookings). */
  _itemStatus?: string | null;
  _itemCheckedOutAt?: string | null;

  _turnoverDeparture?: boolean;
  _turnoverArrival?: boolean;
  [key: string]: any;
}

/**
 * Date the room is physically free again, for lane/turnover purposes.
 *
 * Normally this is the segment's exclusive end. A booking that has already
 * departed frees the room on the business date even if a legacy segment row
 * was never closed at checkout — otherwise a same-day arrival would look like
 * a conflict and the departed chip would get hidden.
 */
export function vacateDate(
  chip: Pick<PlacedChip, "check_in" | "check_out" | "status"> & { _itemStatus?: string | null; _itemCheckedOutAt?: string | null },
  businessDate?: string | null,
) {
  const end = slotEndExclusive(chip);
  if (!businessDate || !isChipDeparted(chip)) return end;
  const floor = nextDay(chip.check_in) > chip.check_in ? nextDay(chip.check_in) : end;
  const clamped = businessDate > floor ? businessDate : floor;
  return clamped < end ? clamped : end;
}

/** Overlap test that respects an early/actual departure. */
export function chipsOverlap(
  a: Pick<PlacedChip, "check_in" | "check_out" | "status"> & { _itemStatus?: string | null; _itemCheckedOutAt?: string | null },
  b: Pick<PlacedChip, "check_in" | "check_out" | "status"> & { _itemStatus?: string | null; _itemCheckedOutAt?: string | null },
  businessDate?: string | null,
) {
  return a.check_in < vacateDate(b, businessDate) && b.check_in < vacateDate(a, businessDate);
}

export interface TurnoverRoom {
  room_id: string;
  room_number: string | null;
  vacate_date: string;
}

export interface PendingArrival {
  key: string;
  booking: any;
  room_type: string | null;
  check_in: string;
  check_out: string;
  /** Rooms of the matching type that free up on the arrival date. */
  turnoverRooms: TurnoverRoom[];
}

export interface PlacementInput {
  bookings: any[];
  itemsByBooking: Map<string, StayItemLike[]>;
  assignmentsByBooking: Map<string, StayAssignmentLike[]>;
  rooms: StayRoomLike[];
  blocks: Array<{ room_id: string; start_date: string; end_date: string }>;
  rangeStart: string;
  rangeEndExclusive: string;
  /** bookingId -> fractional late-checkout extension (0..0.75). */
  lateFractionByBooking: Map<string, number>;
  /** `${roomId}|${date}` -> fraction, seeded from paired segments. */
  outgoingLateSeed: Map<string, number>;
  businessDate?: string | null;
}

export interface PlacementResult {
  byRoom: Map<string, PlacedChip[]>;
  outgoingLateByRoomDay: Map<string, number>;
  pendingArrivals: PendingArrival[];
}

function stripLegacyRoom<T extends { room_id?: string | null }>(booking: T) {
  return { ...booking, room_id: null };
}

export function placeHouseViewChips(input: PlacementInput): PlacementResult {
  const {
    bookings, itemsByBooking, assignmentsByBooking, rooms, blocks,
    rangeStart, rangeEndExclusive, lateFractionByBooking, outgoingLateSeed, businessDate,
  } = input;

  const byRoom = new Map<string, PlacedChip[]>();
  const outMap = new Map(outgoingLateSeed);
  const pendingArrivals: PendingArrival[] = [];

  const bumpOutgoing = (bookingId: string, roomId: string, slot: StaySlot | PlacedChip) => {
    const f = lateFractionByBooking.get(bookingId) ?? 0;
    if (f <= 0) return;
    const key = `${roomId}|${slotEndExclusive(slot)}`;
    if (f > (outMap.get(key) ?? 0)) outMap.set(key, f);
  };
  const conflictsAt = (roomId: string, slot: StaySlot) =>
    (byRoom.get(roomId) ?? []).some((x) => chipsOverlap(slot as any, x, businessDate));
  const blockedAt = (roomId: string, slot: StaySlot) =>
    blocks.some((x) => x.room_id === roomId && slot.check_in < x.end_date && x.start_date < slotEndExclusive(slot));

  // 1) Assigned occupancy — one chip per paired segment.
  for (const b of bookings) {
    const { paired } = pairStaySlotsToRooms(stripLegacyRoom(b), itemsByBooking, assignmentsByBooking, rooms);
    for (const { room_id: rid, slot } of paired) {
      if (!segmentOverlapsRange(slot, rangeStart, rangeEndExclusive)) continue;
      const arr = byRoom.get(rid) ?? [];
      arr.push({
        ...b,
        room_id: rid,
        check_in: slot.check_in,
        check_out: slot.check_out,
        _slotKey: slot.key,
        _bookingCheckIn: b.check_in,
        _bookingCheckOut: b.check_out,
        _itemStatus: slot.item_status ?? null,
        _itemCheckedOutAt: slot.checked_out_at ?? null,
        _historical: !!slot.ended_reason,
      });
      byRoom.set(rid, arr);
    }
  }

  // 2) Virtual placeholders for unpaired (unassigned) stay slots.
  //
  // Suppression is decided PER BOOKING ITEM (per stay slot), never for a whole
  // booking. A multi-room booking is a collection of independent items:
  //   • Real (paired) segments always render on their room — including for a
  //     fully Checked-Out parent booking. That is the room's occupancy history
  //     and step 1 above never filters on booking status.
  //   • A DEPARTED item's *unassigned* slot gets no virtual placeholder: it
  //     represents no physical occupancy at all, so rendering one would fake
  //     occupancy on a free room, consume a lane and push live arrivals into
  //     Room Pending / TBA (previous UAT regression).
  // An item counts as departed when its own item_status / checked_out_at says
  // so, or when the parent booking has departed (all items are then over).
  const slotDeparted = (b: any, slot: StaySlot) =>
    isDepartedStatus(slot.item_status) || !!slot.checked_out_at || isDepartedStatus(b.status);

  const virtualSlots: Array<{ b: any; slot: StaySlot; assignedRoomIds: string[] }> = [];
  for (const b of bookings) {
    const { paired, unpaired } = pairStaySlotsToRooms(stripLegacyRoom(b), itemsByBooking, assignmentsByBooking, rooms);
    const assignedRoomIds = paired.map((p) => p.room_id);
    for (const slot of unpaired) {
      if (slotDeparted(b, slot)) continue;
      if (!segmentOverlapsRange(slot, rangeStart, rangeEndExclusive)) continue;
      virtualSlots.push({ b, slot, assignedRoomIds });
    }
  }


  virtualSlots.sort((a, b) =>
    String(a.slot.check_in).localeCompare(String(b.slot.check_in))
    || String(slotEndExclusive(a.slot)).localeCompare(String(slotEndExclusive(b.slot)))
    || String(a.b.created_at ?? a.b.booking_reference ?? a.b.id).localeCompare(
      String(b.b.created_at ?? b.b.booking_reference ?? b.b.id),
    ),
  );

  for (const { b, slot, assignedRoomIds } of virtualSlots) {
    const matching = rooms.filter((r) => (slot.room_type ? stayRoomTypesMatch(r.room_type, slot.room_type) : true));
    const candidates = matching.length > 0 ? matching : rooms;
    const hasIncomingLate = (rid: string) => (outMap.get(`${rid}|${slot.check_in}`) ?? 0) > 0;

    let placed = false;
    for (const r of candidates) {
      if (assignedRoomIds.includes(r.id)) continue;
      if (conflictsAt(r.id, slot)) continue;
      if (blockedAt(r.id, slot)) continue;
      if (hasIncomingLate(r.id)) continue;
      const arr = byRoom.get(r.id) ?? [];
      arr.push({
        ...b,
        room_id: r.id,
        check_in: slot.check_in,
        check_out: slot.check_out,
        _slotKey: slot.key,
        _bookingCheckIn: b.check_in,
        _bookingCheckOut: b.check_out,
        _itemStatus: slot.item_status ?? null,
        _itemCheckedOutAt: slot.checked_out_at ?? null,
        _virtual: true,
      });
      byRoom.set(r.id, arr);
      bumpOutgoing(b.id, r.id, slot);
      placed = true;
      break;
    }

    if (!placed) {
      // No clean lane — surface it as a Room Pending arrival instead of
      // dropping it off the board. Turnover hints = candidate rooms whose
      // current occupancy ends exactly on the arrival date.
      const turnoverRooms: TurnoverRoom[] = [];
      for (const r of candidates) {
        const chips = byRoom.get(r.id) ?? [];
        const vacating = chips.find((c) => vacateDate(c, businessDate) === slot.check_in);
        if (!vacating) continue;
        turnoverRooms.push({
          room_id: r.id,
          room_number: r.room_number ?? null,
          vacate_date: slot.check_in,
        });
      }
      pendingArrivals.push({
        key: slot.key,
        booking: b,
        room_type: slot.room_type ?? null,
        check_in: slot.check_in,
        check_out: slot.check_out,
        turnoverRooms,
      });
    }
  }

  // Keep the outgoing-late map in sync for paired segments too.
  for (const b of bookings) {
    if ((lateFractionByBooking.get(b.id) ?? 0) <= 0) continue;
    const { paired } = pairStaySlotsToRooms(stripLegacyRoom(b), itemsByBooking, assignmentsByBooking, rooms);
    for (const { room_id: rid, slot } of paired) bumpOutgoing(b.id, rid, slot);
  }

  // 3) Turnover tagging + display-only de-collision.
  //
  // A departed booking is NEVER removed from its room row: its real segment is
  // the room's occupancy history and must stay attached to that room (UAT-053).
  // Same-day turnover is not an overlap at all (segments are half-open), so
  // both chips simply co-exist on the lane.
  //
  // The only messy case is a legacy segment that was never closed at checkout
  // and therefore still spans days a NEW live booking now owns. We do not
  // delete it and we never mutate stored data — we only shorten what is DRAWN
  // so the two chips sit side by side, flagged `_displayClamped`.
  for (const [rid, arr] of byRoom) {
    for (const chip of arr) {
      if (!isChipDeparted(chip)) continue;
      let clampTo: string | null = null;
      for (const other of arr) {
        if (other === chip || isChipDeparted(other)) continue;
        if (!chipsOverlap(chip, other, businessDate)) continue;
        if (other.check_in <= chip.check_in) continue; // nothing left to draw
        if (!clampTo || other.check_in < clampTo) clampTo = other.check_in;
      }
      if (clampTo && clampTo < slotEndExclusive(chip)) {
        chip.check_out = clampTo;
        chip._displayClamped = true;
      }
    }

    for (const chip of arr) {
      for (const other of arr) {
        if (other === chip) continue;
        if (vacateDate(other, businessDate) === chip.check_in) {
          chip._turnoverArrival = true;
          other._turnoverDeparture = true;
        }
      }
    }
    byRoom.set(rid, arr);
  }


  return { byRoom, outgoingLateByRoomDay: outMap, pendingArrivals };
}
