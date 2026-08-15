/**
 * Expected Arrival / Expected Departure — shared engine (pure, no I/O).
 *
 * Two DIFFERENT concepts, deliberately kept separate:
 *   • Pricing window  — HOW the service is priced (EARLY_CHECK_IN_SLOTS /
 *                       LATE_CHECK_OUT_SLOTS in `mock-data.ts`). Unchanged.
 *   • Expected time   — WHEN the guest says they will actually arrive/leave
 *                       (`bookings.expected_arrival_at` /
 *                        `bookings.expected_departure_at`). Blank until the
 *                       guest or staff provides it — the standard check-in /
 *                       check-out time is NEVER treated as an expected time.
 *
 * The expected time is the INPUT that selects the pricing window. Every
 * surface (Booking creation/edit, Add Charge, Guest Portal, House View,
 * Booking Detail) resolves windows and fees through this module — there is no
 * screen-specific pricing logic anywhere else.
 *
 * Idempotency contract (`planExpectedTimeSync`)
 * ---------------------------------------------
 * For each applicable booking item there is at most ONE authoritative
 * Early Check-In and ONE Late Check-Out charge:
 *   1. If the item already carries the quote-level extra
 *      (`early_check_in` / `late_check_out` = true) the extra is RE-PRICED on
 *      the item (it is part of the booking total) and any in-house charge for
 *      that item+category is removed — never both.
 *   2. Otherwise a single in-house `booking_charges` row per item+category is
 *      created, or the existing one (manual or automatic) is UPDATED in place.
 *   3. When the expected time no longer implies the service, the item flag is
 *      cleared and the auto charge is removed.
 * This holds identically for booking creation, booking edit, Add Charge, and
 * Guest Portal updates, and fans out per Booking Item for multi-room bookings.
 */
import {
  EARLY_CHECK_IN_SLOTS,
  LATE_CHECK_OUT_SLOTS,
  type EarlyCheckInSlot,
  type LateCheckOutSlot,
} from "@/lib/mock-data";

/** Canonical charge categories used for expected-time driven services. */
export const EARLY_CHECK_IN_CATEGORY = "Early Check-in";
export const LATE_CHECK_OUT_CATEGORY = "Late Check-out";

export const STANDARD_CHECK_IN = "13:00";
export const STANDARD_CHECK_OUT = "11:00";

/** Minutes since midnight for a "HH:MM" string. `null` when unparseable. */
export function minutesOf(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!(h >= 0 && h <= 23) || !(mm >= 0 && mm <= 59)) return null;
  return h * 60 + mm;
}

/** "HH:MM" (Asia/Kolkata) for a stored timestamp. `null` when absent. */
export function hhmmFromISO(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

/** "9:30 AM" display label for a "HH:MM" string. */
export function to12h(hhmm: string | null | undefined): string {
  const mins = minutesOf(hhmm);
  if (mins == null) return "";
  let h = Math.floor(mins / 60);
  const mm = String(mins % 60).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mm} ${ampm}`;
}

export interface ResolvedWindow<S> {
  slot: S;
  label: string;
  /** Flat fee, or `null` when the window is priced as a full day. */
  fee: number | null;
  fullDay: boolean;
}

/**
 * Expected arrival → Early Check-In pricing window.
 * Arrival at or after the standard check-in time is NOT early check-in.
 */
export function resolveEarlyCheckInWindow(
  expectedArrival: string | null | undefined,
  standardCheckIn: string = STANDARD_CHECK_IN,
): ResolvedWindow<EarlyCheckInSlot> | null {
  const t = minutesOf(expectedArrival);
  if (t == null) return null;
  const std = minutesOf(standardCheckIn) ?? minutesOf(STANDARD_CHECK_IN)!;
  if (t >= std) return null;
  const slot: EarlyCheckInSlot =
    t < minutesOf("06:00")! ? "before-6"
    : t < minutesOf("08:00")! ? "6-8"
    : t < minutesOf("10:00")! ? "8-10"
    : "10-13";
  return describeEarlySlot(slot);
}

/**
 * Expected departure → Late Check-Out pricing window.
 * Departure at or before the standard check-out time is NOT late check-out.
 */
export function resolveLateCheckOutWindow(
  expectedDeparture: string | null | undefined,
  standardCheckOut: string = STANDARD_CHECK_OUT,
): ResolvedWindow<LateCheckOutSlot> | null {
  const t = minutesOf(expectedDeparture);
  if (t == null) return null;
  const std = minutesOf(standardCheckOut) ?? minutesOf(STANDARD_CHECK_OUT)!;
  if (t <= std) return null;
  const slot: LateCheckOutSlot =
    t <= minutesOf("14:00")! ? "upto-2pm"
    : t <= minutesOf("16:00")! ? "2-4pm"
    : "after-4pm";
  return describeLateSlot(slot);
}

export function describeEarlySlot(slot: EarlyCheckInSlot): ResolvedWindow<EarlyCheckInSlot> {
  const s = EARLY_CHECK_IN_SLOTS.find((x) => x.value === slot)!;
  return { slot, label: s.label, fee: s.fee, fullDay: s.fee == null };
}

export function describeLateSlot(slot: LateCheckOutSlot): ResolvedWindow<LateCheckOutSlot> {
  const s = LATE_CHECK_OUT_SLOTS.find((x) => x.value === slot)!;
  return { slot, label: s.label, fee: s.fee, fullDay: s.fee == null };
}

/** Fee for a resolved window; full-day windows fall back to the room rate. */
export function windowFee(
  w: ResolvedWindow<EarlyCheckInSlot | LateCheckOutSlot> | null,
  fullDayRate: number,
): number {
  if (!w) return 0;
  return w.fee == null ? Math.max(0, Number(fullDayRate) || 0) : w.fee;
}

// ---------------------------------------------------------------------------
// Idempotent charge / item reconciliation plan
// ---------------------------------------------------------------------------

export interface PlanItem {
  id: string;
  rate: number;
  early_check_in?: boolean | null;
  early_check_in_slot?: EarlyCheckInSlot | null;
  late_check_out?: boolean | null;
  late_check_out_slot?: LateCheckOutSlot | null;
  item_status?: string | null;
}

export interface PlanCharge {
  id: string;
  item_id: string | null;
  category: string;
  quantity: number;
  unit_price: number;
}

export interface ExpectedTimeSyncInput {
  items: PlanItem[];
  charges: PlanCharge[];
  /** "HH:MM" or null/blank = Not provided. */
  expectedArrival?: string | null;
  expectedDeparture?: string | null;
  /** Restrict the service to these booking items. `null` = all active items. */
  applyItemIds?: string[] | null;
  standardCheckIn?: string;
  standardCheckOut?: string;
  /** Skip the arrival/departure half of the plan (e.g. Add Charge → one service). */
  syncEarly?: boolean;
  syncLate?: boolean;
}

export interface ExpectedTimeSyncPlan {
  early: ResolvedWindow<EarlyCheckInSlot> | null;
  late: ResolvedWindow<LateCheckOutSlot> | null;
  itemUpdates: { id: string; patch: Record<string, unknown> }[];
  chargeCreates: {
    item_id: string;
    category: string;
    quantity: number;
    unit_price: number;
    notes: string;
  }[];
  chargeUpdates: { id: string; quantity: number; unit_price: number; notes: string }[];
  chargeDeletes: string[];
}

const noteFor = (label: string, expected: string) =>
  `${label} · Expected ${to12h(expected)}`;

export function planExpectedTimeSync(input: ExpectedTimeSyncInput): ExpectedTimeSyncPlan {
  const syncEarly = input.syncEarly !== false;
  const syncLate = input.syncLate !== false;
  const early = syncEarly
    ? resolveEarlyCheckInWindow(input.expectedArrival, input.standardCheckIn)
    : null;
  const late = syncLate
    ? resolveLateCheckOutWindow(input.expectedDeparture, input.standardCheckOut)
    : null;

  const activeItems = input.items.filter((i) => (i.item_status ?? "") !== "Removed");
  const scoped =
    input.applyItemIds && input.applyItemIds.length > 0
      ? activeItems.filter((i) => input.applyItemIds!.includes(i.id))
      : activeItems;

  const plan: ExpectedTimeSyncPlan = {
    early,
    late,
    itemUpdates: [],
    chargeCreates: [],
    chargeUpdates: [],
    chargeDeletes: [],
  };

  const patches = new Map<string, Record<string, unknown>>();
  const patch = (id: string, p: Record<string, unknown>) => {
    patches.set(id, { ...(patches.get(id) ?? {}), ...p });
  };

  const findCharge = (itemId: string, category: string) =>
    input.charges.find(
      (c) => c.item_id === itemId && c.category.toLowerCase() === category.toLowerCase(),
    );

  const reconcile = (
    category: string,
    win: ResolvedWindow<EarlyCheckInSlot | LateCheckOutSlot> | null,
    expected: string | null | undefined,
    flagKey: "early_check_in" | "late_check_out",
    slotKey: "early_check_in_slot" | "late_check_out_slot",
  ) => {
    for (const it of scoped) {
      const existing = findCharge(it.id, category);
      const carriesExtra = !!it[flagKey];
      if (!win) {
        // Service no longer applies → clear the item extra and drop the charge.
        if (carriesExtra) patch(it.id, { [flagKey]: false, [slotKey]: null });
        if (existing) plan.chargeDeletes.push(existing.id);
        continue;
      }
      if (carriesExtra) {
        // The quote-level extra stays authoritative; just re-price the window.
        if (it[slotKey] !== win.slot) patch(it.id, { [flagKey]: true, [slotKey]: win.slot });
        if (existing) plan.chargeDeletes.push(existing.id);
        continue;
      }
      const unit = windowFee(win, it.rate);
      const notes = noteFor(win.label, expected ?? "");
      if (existing) {
        if (
          Number(existing.unit_price) !== unit ||
          Number(existing.quantity) !== 1
        ) {
          plan.chargeUpdates.push({ id: existing.id, quantity: 1, unit_price: unit, notes });
        }
      } else {
        plan.chargeCreates.push({
          item_id: it.id,
          category,
          quantity: 1,
          unit_price: unit,
          notes,
        });
      }
    }
  };

  if (syncEarly)
    reconcile(EARLY_CHECK_IN_CATEGORY, early, input.expectedArrival, "early_check_in", "early_check_in_slot");
  if (syncLate)
    reconcile(LATE_CHECK_OUT_CATEGORY, late, input.expectedDeparture, "late_check_out", "late_check_out_slot");

  for (const [id, p] of patches) plan.itemUpdates.push({ id, patch: p });
  return plan;
}
