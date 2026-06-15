export type StayBookingLike = {
  id: string;
  room_id?: string | null;
  check_in: string;
  check_out: string;
};

export type StayItemLike = {
  booking_id: string;
  position?: number | null;
  room_type?: string | null;
  rooms?: number | null;
  check_in?: string | null;
  check_out?: string | null;
};

export type StayAssignmentLike = {
  room_id: string;
  booking_id?: string | null;
  created_at?: string | null;
};

export type StayRoomLike = {
  id: string;
  room_type?: string | null;
  room_number?: string | null;
};

export type StaySlot = {
  key: string;
  booking_id: string;
  room_type: string | null;
  check_in: string;
  check_out: string;
};

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

export function segmentCoversDate(slot: Pick<StaySlot, "check_in" | "check_out">, date: string) {
  return slot.check_in <= date && slot.check_out >= date;
}

export function segmentOverlapsRange(slot: Pick<StaySlot, "check_in" | "check_out">, rangeStart: string, rangeEndExclusive: string) {
  return slot.check_in < rangeEndExclusive && slot.check_out >= rangeStart;
}

export function segmentsOverlap(a: Pick<StaySlot, "check_in" | "check_out">, b: Pick<StaySlot, "check_in" | "check_out">) {
  return a.check_in <= b.check_out && b.check_in <= a.check_out;
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
    }] satisfies StaySlot[];
  }

  return [...items]
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .flatMap((item, itemIndex) => {
      const count = Math.max(1, Number(item.rooms ?? 1));
      return Array.from({ length: count }, (_, roomIndex) => ({
        key: `${booking.id}:${item.position ?? itemIndex}:${roomIndex}`,
        booking_id: booking.id,
        room_type: item.room_type ?? null,
        check_in: item.check_in || booking.check_in,
        check_out: item.check_out || booking.check_out,
      }) satisfies StaySlot);
    });
}

export function pairStaySlotsToRooms(
  booking: StayBookingLike,
  itemsByBooking: Map<string, StayItemLike[]>,
  assignmentsByBooking: Map<string, StayAssignmentLike[]>,
  rooms: StayRoomLike[],
) {
  const slots = expandStaySlots(booking, itemsByBooking.get(booking.id) ?? []);
  const assigned = [...(assignmentsByBooking.get(booking.id) ?? [])];
  if (assigned.length === 0 && booking.room_id) assigned.push({ room_id: booking.room_id, booking_id: booking.id });

  assigned.sort((a, b) => {
    if (booking.room_id && a.room_id === booking.room_id) return -1;
    if (booking.room_id && b.room_id === booking.room_id) return 1;
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });

  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const used = new Set<number>();
  const paired: Array<{ room_id: string; slot: StaySlot }> = [];

  for (const assignment of assigned) {
    const room = roomById.get(assignment.room_id);
    let slotIndex = slots.findIndex((slot, index) => !used.has(index) && stayRoomTypesMatch(room?.room_type, slot.room_type));
    if (slotIndex < 0) slotIndex = slots.findIndex((_, index) => !used.has(index));
    if (slotIndex < 0) continue;
    used.add(slotIndex);
    paired.push({ room_id: assignment.room_id, slot: slots[slotIndex] });
  }

  return {
    paired,
    unpaired: slots.filter((_, index) => !used.has(index)),
    slots,
  };
}