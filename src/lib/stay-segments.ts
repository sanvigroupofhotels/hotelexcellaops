export type StayBookingLike = {
  id: string;
  room_id?: string | null;
  check_in: string;
  check_out: string;
};

export type StayItemLike = {
  id?: string | null;
  booking_id: string;
  position?: number | null;
  assigned_room_id?: string | null;
  room_type?: string | null;
  rooms?: number | null;
  check_in?: string | null;
  check_out?: string | null;
  /** Per-item operational status (Confirmed / Checked-In / Checked-Out ...). */
  item_status?: string | null;
  /** Set when this specific room item was checked out. */
  checked_out_at?: string | null;
};

export type StayAssignmentLike = {
  id?: string | null;
  room_id: string;
  booking_id?: string | null;
  item_id?: string | null;
  created_at?: string | null;
  /** Segment start (inclusive YYYY-MM-DD). Optional for legacy callers. */
  start_date?: string | null;
  /** Segment end (exclusive YYYY-MM-DD). Optional for legacy callers. */
  end_date?: string | null;
  /** Segment closure reason: 'room_change' marks a historical segment. */
  ended_reason?: string | null;
};


export type StayRoomLike = {
  id: string;
  room_type?: string | null;
  room_number?: string | null;
};

export type StaySlot = {
  key: string;
  booking_id: string;
  item_id?: string | null;
  room_type: string | null;
  check_in: string;
  check_out: string;
  /** Set on paired slots when the underlying assignment is a closed historical segment. */
  ended_reason?: string | null;
  /** Per-item operational status carried from booking_items (item-level state). */
  item_status?: string | null;
  /** Per-item checkout timestamp carried from booking_items. */
  checked_out_at?: string | null;
  /**
   * Closed segment covering zero nights (arrival and departure on the same
   * day). It is real occupancy history and must stay visible, but it releases
   * the room the same day so a turnover arrival can take it.
   */
  zero_night?: boolean;
};

const DEPARTED_ITEM_STATUSES = new Set(["Checked-Out"]);


export function normalizeStayRoomType(value?: string | null) {
  return (value || "")
    .toLowerCase()
    .replace(/\s+room\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function stayRoomTypesMatch(roomType?: string | null, itemType?: string | null) {
  const a = normalizeStayRoomType(roomType);
  const b = normalizeStayRoomType(itemType);
  return !!a && !!b && a === b;
}

/**
 * Stays end at noon on check_out — the room is vacant FROM check_out onwards.
 * For day-use stays (check_in === check_out) we treat the room as occupied for
 * that single day. `slotEndExclusive` returns the first vacant date.
 */
export function slotEndExclusive(slot: Pick<StaySlot, "check_in" | "check_out">) {
  if (slot.check_in === slot.check_out) {
    const d = new Date(slot.check_in + "T00:00:00");
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return slot.check_out;
}

export function segmentCoversDate(slot: Pick<StaySlot, "check_in" | "check_out">, date: string) {
  return slot.check_in <= date && date < slotEndExclusive(slot);
}

export function segmentOverlapsRange(slot: Pick<StaySlot, "check_in" | "check_out">, rangeStart: string, rangeEndExclusive: string) {
  return slot.check_in < rangeEndExclusive && rangeStart < slotEndExclusive(slot);
}

export function segmentsOverlap(a: Pick<StaySlot, "check_in" | "check_out">, b: Pick<StaySlot, "check_in" | "check_out">) {
  return a.check_in < slotEndExclusive(b) && b.check_in < slotEndExclusive(a);
}

export function groupStayItems(items: StayItemLike[]) {
  const map = new Map<string, StayItemLike[]>();
  for (const item of items) {
    const arr = map.get(item.booking_id) ?? [];
    arr.push(item);
    map.set(item.booking_id, arr);
  }
  return map;
}

export function groupStayAssignments(assignments: StayAssignmentLike[]) {
  const map = new Map<string, StayAssignmentLike[]>();
  for (const assignment of assignments) {
    if (!assignment.booking_id) continue;
    const arr = map.get(assignment.booking_id) ?? [];
    arr.push(assignment);
    map.set(assignment.booking_id, arr);
  }
  return map;
}

export function expandStaySlots(booking: StayBookingLike, items: StayItemLike[]) {
  if (!items.length) {
    return [{
      key: `${booking.id}:legacy:0`,
      booking_id: booking.id,
      room_type: null,
      check_in: booking.check_in,
      check_out: booking.check_out,
      item_status: null,
      checked_out_at: null,
    }] satisfies StaySlot[];
  }

  return [...items]
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .flatMap((item, itemIndex) => {
      const count = Math.max(1, Number(item.rooms ?? 1));
      return Array.from({ length: count }, (_, roomIndex) => ({
        key: `${booking.id}:${item.id ?? item.position ?? itemIndex}:${roomIndex}`,
        booking_id: booking.id,
        item_id: item.id ?? null,
        room_type: item.room_type ?? null,
        check_in: item.check_in || booking.check_in,
        check_out: item.check_out || booking.check_out,
        item_status: item.item_status ?? null,
        checked_out_at: item.checked_out_at ?? null,
      }) satisfies StaySlot);
    });
}

export function pairStaySlotsToRooms(
  booking: StayBookingLike,
  itemsByBooking: Map<string, StayItemLike[]>,
  assignmentsByBooking: Map<string, StayAssignmentLike[]>,
  rooms: StayRoomLike[],
  opts?: { businessDate?: string | null; includeItemAssignmentFallback?: boolean },
) {
  const items = itemsByBooking.get(booking.id) ?? [];
  const slots = expandStaySlots(booking, items);
  const assigned = [...(assignmentsByBooking.get(booking.id) ?? [])];

  // Compatibility fallback for bookings that have an item-level room pointer
  // (`booking_items.assigned_room_id`) but no occupancy segment row. That state
  // is legacy/broken data, but it is still a REAL room assignment made by
  // reception. House View must render it as a grey departed chip after checkout,
  // while still suppressing truly unassigned departed items.
  if (opts?.includeItemAssignmentFallback) {
    for (const [idx, item] of items.entries()) {
      if (!item.assigned_room_id) continue;
      const itemStart = item.check_in || booking.check_in;
      const itemOut = item.check_out || booking.check_out;
      const itemEnd = slotEndExclusive({ check_in: itemStart, check_out: itemOut });
      const alreadySegmented = assigned.some((a) => {
        if (item.id && a.item_id === item.id) return true;
        const aStart = String(a.start_date ?? booking.check_in);
        const aEnd = String(a.end_date ?? booking.check_out);
        return a.room_id === item.assigned_room_id && itemStart < aEnd && aStart < itemEnd;
      });
      if (alreadySegmented) continue;

      const departed = DEPARTED_ITEM_STATUSES.has(String(item.item_status ?? "")) || !!item.checked_out_at;
      let fallbackEnd = itemOut === itemStart ? itemEnd : itemOut;
      if (departed && opts.businessDate) {
        const closeDate = opts.businessDate > itemStart ? opts.businessDate : itemStart;
        fallbackEnd = closeDate < fallbackEnd ? closeDate : fallbackEnd;
      }

      assigned.push({
        id: `item-fallback-${item.id ?? idx}`,
        room_id: item.assigned_room_id,
        booking_id: booking.id,
        item_id: item.id ?? null,
        start_date: itemStart,
        end_date: fallbackEnd,
        ended_reason: departed ? "item_check_out" : null,
        created_at: null,
      });
    }
  }

  if (assigned.length === 0 && booking.room_id) {
    assigned.push({
      room_id: booking.room_id,
      booking_id: booking.id,
      start_date: booking.check_in,
      end_date: booking.check_out === booking.check_in
        ? slotEndExclusive({ check_in: booking.check_in, check_out: booking.check_out })
        : booking.check_out,
    });
  }

  // Order segments by start_date so mid-stay swaps register in real chronological
  // order — old room then new room, preserving history.
  assigned.sort((a, b) => {
    const sa = String(a.start_date ?? booking.check_in);
    const sb = String(b.start_date ?? booking.check_in);
    if (sa !== sb) return sa.localeCompare(sb);
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });

  const roomById = new Map(rooms.map((room) => [room.id, room]));
  // Per-slot cursor tracks how much of the slot's date range has been paired.
  const cursors = slots.map((s) => s.check_in);
  const paired: Array<{ room_id: string; slot: StaySlot }> = [];

  for (const assignment of assigned) {
    const room = roomById.get(assignment.room_id);
    const segStart = String(assignment.start_date ?? booking.check_in);
    const segEnd = String(assignment.end_date ?? booking.check_out);

    // ZERO-NIGHT closed segment (checked out on the arrival date). The date
    // range is empty, so the generic intersection below can never match it —
    // yet the room really was occupied that day. Emit a one-day departed chip
    // and do NOT advance the slot cursor (no nights were consumed).
    if (segEnd <= segStart) {
      let idx = assignment.item_id
        ? slots.findIndex((s, i) => s.item_id === assignment.item_id && cursors[i] <= segStart && segStart < slotEndExclusive(s))
        : -1;
      if (idx < 0) idx = slots.findIndex((s, i) =>
          cursors[i] <= segStart && segStart < slotEndExclusive(s)
          && stayRoomTypesMatch(room?.room_type, s.room_type));
      const zeroIdx = idx >= 0
        ? idx
        : slots.findIndex((s, i) => cursors[i] <= segStart && segStart < slotEndExclusive(s));
      const base = slots[zeroIdx >= 0 ? zeroIdx : 0];
      if (base) {
        paired.push({
          room_id: assignment.room_id,
          slot: {
            key: `${base.key}:${assignment.id ?? assignment.room_id}:${segStart}:zero`,
            booking_id: booking.id,
            item_id: base.item_id ?? null,
            room_type: base.room_type,
            check_in: segStart,
            check_out: segStart,
            ended_reason: assignment.ended_reason ?? null,
            item_status: base.item_status ?? null,
            checked_out_at: base.checked_out_at ?? null,
            zero_night: true,
          },
        });
      }
      continue;
    }



    // Prefer a slot with matching room_type whose remaining window overlaps
    // the segment window; fall back to any slot with a remaining overlap.
    const overlaps = (slotIdx: number) => {
      const s = slots[slotIdx];
      const cursor = cursors[slotIdx];
      const slotEnd = slotEndExclusive(s);
      const a = cursor > segStart ? cursor : segStart;
      const b = slotEnd < segEnd ? slotEnd : segEnd;
      return a < b ? { a, b } : null;
    };

    let slotIndex = assignment.item_id
      ? slots.findIndex((slot, i) => slot.item_id === assignment.item_id && !!overlaps(i))
      : -1;
    if (slotIndex < 0) slotIndex = slots.findIndex((slot, i) => overlaps(i) && stayRoomTypesMatch(room?.room_type, slot.room_type));
    if (slotIndex < 0) slotIndex = slots.findIndex((_, i) => !!overlaps(i));
    if (slotIndex < 0) continue;

    const range = overlaps(slotIndex)!;
    const base = slots[slotIndex];
    // Emit a slot narrowed to the segment intersection so House View chips
    // render each segment on its own date range.
    paired.push({
      room_id: assignment.room_id,
      slot: {
        key: `${base.key}:${assignment.id ?? assignment.room_id}:${range.a}`,
        booking_id: booking.id,
        item_id: base.item_id ?? null,
        room_type: base.room_type,
        check_in: range.a,
        // Keep half-open semantics: chip's check_out is exclusive in day-use
        // math (see slotEndExclusive). For multi-day segments range.b is the
        // exclusive end date, which is already correct as check_out.
        check_out: range.b,
        ended_reason: assignment.ended_reason ?? null,
        item_status: base.item_status ?? null,
        checked_out_at: base.checked_out_at ?? null,
      },
    });
    cursors[slotIndex] = range.b;
  }

  // Unpaired = slots whose cursor didn't reach their check_out (or day-use end).
  const unpaired: StaySlot[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const cursor = cursors[i];
    const slotEnd = slotEndExclusive(s);
    if (cursor < slotEnd) {
      unpaired.push({
        key: `${s.key}:unpaired:${cursor}`,
        booking_id: booking.id,
        room_type: s.room_type,
        check_in: cursor,
        check_out: s.check_out === s.check_in && cursor === s.check_in ? s.check_out : slotEnd,
        item_status: s.item_status ?? null,
        checked_out_at: s.checked_out_at ?? null,
      });
    }
  }

  return { paired, unpaired, slots };
}
