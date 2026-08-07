/**
 * Guest Allocation Engine — the single implementation of "how do N adults and
 * M children spread across R rooms".
 *
 * Owns:
 *   • Room-type occupancy configuration (standard / maximum adults + children,
 *     extra-adult / extra-child pricing) — read from `mock-data.ROOM_TARIFFS`
 *     so different room categories can carry different capacities.
 *   • Distribution of booking-level guest counts onto Booking Item lines.
 *   • Per-room expansion of a multi-room line (used by `booking-items-api`
 *     when persisting `booking_items`), including derived Extra Adults /
 *     Extra Children so the shared pricing engine charges them automatically.
 *
 * Consumers: Quick Booking, Detailed Booking, Clone Booking, quote → booking
 * conversion and any future Booking Engine / OTA import. No creation path may
 * re-implement guest distribution — extend this engine instead.
 */
import { ROOM_TARIFFS, EXTRA_ADULT_RATE } from "@/lib/mock-data";
import type { LineItem } from "@/components/line-items-editor";

export interface OccupancyConfig {
  standardAdults: number;
  maxAdults: number;
  standardChildren: number;
  maxChildren: number;
  extraAdultRate: number;
  extraChildRate: number;
}

export const DEFAULT_OCCUPANCY: OccupancyConfig = {
  standardAdults: 2,
  maxAdults: 3,
  standardChildren: 2,
  maxChildren: 2,
  extraAdultRate: EXTRA_ADULT_RATE,
  extraChildRate: 0,
};

/**
 * Occupancy rules per room type.
 *
 * SOURCE OF TRUTH: the room *category* owns occupancy; tariffs own pricing.
 * Today both live on `ROOM_TARIFFS` because the room-type catalogue and the
 * tariff table are the same record in this schema. When a dedicated Room Type
 * Master lands, only this function changes — every consumer reads occupancy
 * through `getOccupancyConfig`, never from a tariff row directly.
 */
export function getOccupancyConfig(roomType: string): OccupancyConfig {
  const tariff = ROOM_TARIFFS.find((r) => r.name === roomType) as
    | (typeof ROOM_TARIFFS)[number] & { occupancy?: Partial<OccupancyConfig> }
    | undefined;
  return { ...DEFAULT_OCCUPANCY, ...(tariff?.occupancy ?? {}) };
}

/** Per-room capacity pair used by the capacity-aware spread. */
export interface RoomCapacity {
  standard: number;
  max: number;
}

/**
 * Spread `total` heads across rooms that may each have DIFFERENT capacities
 * (mixed room types in one booking). Fill every room up to ITS OWN standard
 * round-robin first, then up to ITS OWN max, then keep going round-robin so no
 * guest is silently dropped.
 */
export function spreadHeadsAcross(total: number, caps: RoomCapacity[]): number[] {
  const r = caps.length;
  const alloc = new Array<number>(Math.max(0, r)).fill(0);
  if (r === 0) return alloc;
  let remaining = Math.max(0, Math.floor(total));
  const pass = (capOf: (i: number) => number) => {
    let progressed = true;
    while (remaining > 0 && progressed) {
      progressed = false;
      for (let i = 0; i < r && remaining > 0; i++) {
        if (alloc[i] < capOf(i)) {
          alloc[i] += 1;
          remaining -= 1;
          progressed = true;
        }
      }
    }
  };
  pass((i) => Math.max(0, caps[i].standard));
  pass((i) => Math.max(caps[i].standard, caps[i].max));
  // Over-capacity party — keep distributing so counts always reconcile.
  while (remaining > 0) {
    for (let i = 0; i < r && remaining > 0; i++) {
      alloc[i] += 1;
      remaining -= 1;
    }
  }
  return alloc;
}

/**
 * Uniform-capacity convenience wrapper (single room type).
 *
 *   5 adults / 2 rooms → [3, 2]      6 / 2 → [3, 3]
 *   7 adults / 3 rooms → [3, 2, 2]   5 / 3 → [2, 2, 1]
 */
export function spreadHeads(total: number, rooms: number, standard: number, max: number): number[] {
  const r = Math.max(1, Math.floor(rooms));
  return spreadHeadsAcross(
    total,
    Array.from({ length: r }, () => ({ standard, max })),
  );
}


export interface RoomAllocation {
  adults: number;
  children: number;
  extra_adults: number;
  extra_children: number;
}

/** Allocation for one room-type line covering `rooms` physical rooms. */
export function allocateRooms(input: {
  room_type: string;
  rooms: number;
  adults: number;
  children: number;
}): RoomAllocation[] {
  const cfg = getOccupancyConfig(input.room_type);
  const rooms = Math.max(1, Math.floor(input.rooms || 1));
  const adults = spreadHeads(input.adults, rooms, cfg.standardAdults, cfg.maxAdults);
  const children = spreadHeads(input.children, rooms, cfg.standardChildren, cfg.maxChildren);
  return adults.map((a, i) => ({
    adults: a,
    children: children[i] ?? 0,
    extra_adults: Math.max(0, a - cfg.standardAdults),
    extra_children: Math.max(0, (children[i] ?? 0) - cfg.standardChildren),
  }));
}

/** Derived Extra Adults for a whole line (sum of its per-room extras). */
export function deriveLineExtraAdults(line: Pick<LineItem, "room_type" | "rooms" | "adults">): number {
  return allocateRooms({
    room_type: line.room_type,
    rooms: line.rooms ?? 1,
    adults: line.adults ?? 0,
    children: 0,
  }).reduce((s, a) => s + a.extra_adults, 0);
}

/**
 * Normalise a line so its Extra Adults reflect the occupancy rules. Manual
 * over-rides above the derived value are preserved (reception may add a
 * mattress voluntarily); values below it are corrected upward so pricing is
 * never understated.
 */
export function normalizeLineGuests(line: LineItem): LineItem {
  const derived = deriveLineExtraAdults(line);
  return { ...line, extra_adults: Math.max(derived, line.extra_adults ?? 0) };
}

/**
 * Expand one line into per-room lines (`rooms: 1` each) with the party spread
 * according to the occupancy rules. Used when persisting `booking_items`.
 */
export function expandLineToRooms(line: LineItem): LineItem[] {
  const rooms = Math.max(1, Math.floor(line.rooms ?? 1));
  const alloc = allocateRooms({
    room_type: line.room_type,
    rooms,
    adults: line.adults ?? 0,
    children: line.children ?? 0,
  });
  // Manual extras above the derived total are shared out room-by-room.
  const derivedTotal = alloc.reduce((s, a) => s + a.extra_adults, 0);
  const manualSurplus = Math.max(0, (line.extra_adults ?? 0) - derivedTotal);
  const surplus = spreadHeads(manualSurplus, rooms, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const drivers = spreadHeads(line.drivers ?? 0, rooms, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const extraBeds = spreadHeads(line.extra_bed ?? 0, rooms, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);

  return alloc.map((a, i) => ({
    ...line,
    rooms: 1,
    adults: a.adults,
    children: a.children,
    extra_adults: a.extra_adults + (surplus[i] ?? 0),
    drivers: drivers[i] ?? 0,
    extra_bed: extraBeds[i] ?? 0,
  }));
}

/**
 * Distribute booking-level guest counts across selected room-type lines,
 * proportionally to each line's room count, then normalise Extra Adults.
 * Lines with `rooms <= 0` are ignored.
 */
export function allocateGuestsToLines(
  lines: LineItem[],
  party: { adults: number; children: number },
): LineItem[] {
  const active = lines.filter((l) => (l.rooms ?? 0) > 0);
  const totalRooms = active.reduce((s, l) => s + (l.rooms ?? 0), 0);
  if (totalRooms === 0) return lines;

  // Allocate per physical room first, then fold rooms back into their line.
  const perRoomType: { line: LineItem; count: number }[] = active.map((l) => ({ line: l, count: l.rooms ?? 0 }));
  const flatRooms: number[] = [];
  perRoomType.forEach((entry, idx) => {
    for (let i = 0; i < entry.count; i++) flatRooms.push(idx);
  });

  // Use the first line's occupancy as the spread reference when mixing types;
  // per-room extras are recomputed per line afterwards.
  const cfg = getOccupancyConfig(active[0].room_type);
  const adultsPerRoom = spreadHeads(party.adults, flatRooms.length, cfg.standardAdults, cfg.maxAdults);
  const childrenPerRoom = spreadHeads(party.children, flatRooms.length, cfg.standardChildren, cfg.maxChildren);

  const sums = perRoomType.map(() => ({ adults: 0, children: 0 }));
  flatRooms.forEach((lineIdx, roomIdx) => {
    sums[lineIdx].adults += adultsPerRoom[roomIdx] ?? 0;
    sums[lineIdx].children += childrenPerRoom[roomIdx] ?? 0;
  });

  const allocated = perRoomType.map((entry, idx) =>
    normalizeLineGuests({
      ...entry.line,
      adults: sums[idx].adults,
      children: sums[idx].children,
      extra_adults: 0,
    }),
  );

  // Preserve original ordering / inactive lines.
  let cursor = 0;
  return lines.map((l) => ((l.rooms ?? 0) > 0 ? allocated[cursor++] : l));
}
