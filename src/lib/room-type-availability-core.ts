export interface AvailabilityRoomRow {
  id: string;
  room_type: string | null;
}

export interface AvailabilityBookingItemRow {
  booking_id: string;
  room_type: string | null;
  rooms?: number | null;
  check_in?: string | null;
  check_out?: string | null;
  item_status?: string | null;
  bookings?: {
    id?: string | null;
    status?: string | null;
    check_in?: string | null;
    check_out?: string | null;
    draft_expires_at?: string | null;
  } | null;
}

export interface AvailabilityLegacyBookingRow {
  id: string;
  room_id?: string | null;
  room_details?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  status?: string | null;
  draft_expires_at?: string | null;
}

export interface AvailabilityMaintenanceBlockRow {
  room_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  room_type?: string | null;
  rooms?: { room_type?: string | null } | null;
}

export interface RoomTypeAvailabilityCoreRow {
  room_type: string;
  total: number;
  booked: number;
  blocked: number;
  available: number;
}

export interface RoomTypeAvailabilityCoreResult {
  byType: Record<string, RoomTypeAvailabilityCoreRow>;
}

const COMMITTED_DEMAND_STATUSES = new Set([
  "Pending",
  "Confirmed",
  "Advance Paid",
  "Full Paid",
  "Checked-In",
]);

const TERMINAL_ITEM_STATUSES = new Set([
  "Checked-Out",
  "Cancelled",
  "No-Show",
  "Removed",
]);

export function normalizeRoomTypeKey(label: string): string {
  return String(label || "").trim().replace(/\s+room$/i, "").toLowerCase();
}

export function dateNights(check_in: string, check_out: string): string[] {
  const nights: string[] = [];
  const start = new Date(check_in + "T00:00:00Z");
  const end = new Date(check_out + "T00:00:00Z");
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    nights.push(d.toISOString().slice(0, 10));
  }
  return nights;
}

export function addLocalDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function shouldCountDemand(status: string | null | undefined, draftExpiresAt: string | null | undefined, includeDraftHolds: boolean, nowMs: number) {
  if (status === "Draft") {
    if (!includeDraftHolds) return false;
    return !draftExpiresAt || new Date(draftExpiresAt).getTime() >= nowMs;
  }
  return COMMITTED_DEMAND_STATUSES.has(status ?? "");
}

function addPeakDemand(
  target: Record<string, Record<string, number>>,
  key: string,
  start: string,
  end: string,
  units: number,
  nights: string[],
) {
  const effectiveEnd = start === end ? addLocalDay(start) : end;
  if (!target[key]) target[key] = {};
  for (const night of nights) {
    if (start <= night && night < effectiveEnd) {
      target[key][night] = (target[key][night] ?? 0) + units;
    }
  }
}

function peakByKey(perKeyNight: Record<string, Record<string, number>>) {
  const out: Record<string, number> = {};
  for (const [key, perNight] of Object.entries(perKeyNight)) {
    let peak = 0;
    for (const v of Object.values(perNight)) if (v > peak) peak = v;
    out[key] = peak;
  }
  return out;
}

export function buildRoomTypeAvailability(input: {
  check_in: string;
  check_out: string;
  rooms: AvailabilityRoomRow[];
  bookingItems: AvailabilityBookingItemRow[];
  maintenanceBlocks: AvailabilityMaintenanceBlockRow[];
  legacyBookings?: AvailabilityLegacyBookingRow[];
  exclude_booking_id?: string | null;
  includeDraftHolds?: boolean;
  nowMs?: number;
}): RoomTypeAvailabilityCoreResult {
  const {
    check_in,
    check_out,
    rooms,
    bookingItems,
    maintenanceBlocks,
    legacyBookings = [],
    exclude_booking_id,
    includeDraftHolds = false,
    nowMs = Date.now(),
  } = input;

  if (!check_in || !check_out || check_in >= check_out) return { byType: {} };

  const totalByKey: Record<string, { label: string; total: number }> = {};
  const roomTypeById = new Map<string, string>();
  const activeRoomIds = new Set<string>();
  for (const r of rooms) {
    const label = r.room_type ?? "Other";
    const key = normalizeRoomTypeKey(label);
    if (!totalByKey[key]) totalByKey[key] = { label, total: 0 };
    totalByKey[key].total += 1;
    activeRoomIds.add(r.id);
    roomTypeById.set(r.id, label);
  }

  const nights = dateNights(check_in, check_out);
  const demandByKeyNight: Record<string, Record<string, number>> = {};
  const itemBookingIds = new Set<string>();

  for (const it of bookingItems) {
    itemBookingIds.add(it.booking_id);
    if (exclude_booking_id && it.booking_id === exclude_booking_id) continue;
    if (TERMINAL_ITEM_STATUSES.has(it.item_status ?? "")) continue;
    const booking = it.bookings;
    if (!shouldCountDemand(booking?.status, booking?.draft_expires_at, includeDraftHolds, nowMs)) continue;
    const key = normalizeRoomTypeKey(it.room_type ?? "");
    if (!key) continue;
    const start = it.check_in ?? booking?.check_in ?? null;
    const end = it.check_out ?? booking?.check_out ?? null;
    if (!start || !end) continue;
    addPeakDemand(demandByKeyNight, key, start, end, Math.max(1, Number(it.rooms ?? 1) || 1), nights);
  }

  for (const b of legacyBookings) {
    if (exclude_booking_id && b.id === exclude_booking_id) continue;
    if (itemBookingIds.has(b.id)) continue;
    if (!shouldCountDemand(b.status, b.draft_expires_at, includeDraftHolds, nowMs)) continue;
    const start = b.check_in ?? null;
    const end = b.check_out ?? null;
    if (!start || !end) continue;
    const label = b.room_id ? roomTypeById.get(b.room_id) : b.room_details;
    const key = normalizeRoomTypeKey(label ?? "");
    if (!key) continue;
    addPeakDemand(demandByKeyNight, key, start, end, 1, nights);
  }

  const blockDemandByKeyNight: Record<string, Record<string, number>> = {};
  for (const m of maintenanceBlocks) {
    if (m.room_id && !activeRoomIds.has(m.room_id)) continue;
    const label = m.room_type ?? m.rooms?.room_type ?? (m.room_id ? roomTypeById.get(m.room_id) : null) ?? "";
    const key = normalizeRoomTypeKey(label);
    const start = m.start_date ?? null;
    const end = m.end_date ?? null;
    if (!key || !start || !end) continue;
    addPeakDemand(blockDemandByKeyNight, key, start, end, 1, nights);
  }

  const bookedByKey = peakByKey(demandByKeyNight);
  const blockedByKey = peakByKey(blockDemandByKeyNight);
  const byType: Record<string, RoomTypeAvailabilityCoreRow> = {};
  for (const [key, { label, total }] of Object.entries(totalByKey)) {
    const booked = bookedByKey[key] ?? 0;
    const blocked = blockedByKey[key] ?? 0;
    byType[label] = {
      room_type: label,
      total,
      booked,
      blocked,
      available: Math.max(0, total - booked - blocked),
    };
  }
  return { byType };
}