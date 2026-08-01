import { useQuery } from "@tanstack/react-query";
import { listChargeCatalog, type ChargeCatalogRow, type ChargeApplicationMode } from "@/lib/charge-catalog-api";

const FALLBACK = [
  "Water Bottle", "Soft Drinks", "Food Order", "Laundry", "Extra Bed",
  "Early Check-in", "Late Check-out", "Extra Adult", "Extra Pet",
  "Transportation", "Printing Charges", "Dental Kit", "Shaving Kit",
  "Coffee", "Tea", "Other",
];

/**
 * Labels that default to `per_booking` when the catalog row has no explicit
 * application_mode (free-text "Other" or fallback seed entries). Everything
 * else defaults to `per_room` — room-consumed services (Water Bottle, Food
 * Order, Laundry, Extra Bed, Early Check-In …) must stay attributed to the
 * room that consumed them.
 */
const PER_BOOKING_HEURISTIC = new Set(
  ["other", "past due", "razorpay charges", "booking fee", "airport pickup",
   "airport transfer", "airport drop", "conference package", "package"]
);


/**
 * Single source of truth for guest-chargeable item labels.
 * Reads from `charge_catalog` (Operations → Charge Catalog).
 *
 * Returns:
 *  • `values`   — display labels (backward-compatible with existing rows/reports).
 *  • `modeFor`  — lookup that returns the configured application_mode for a
 *                 given label; falls back to a heuristic then `per_booking`.
 */
export function useChargeCategories(fallback: string[] = FALLBACK) {
  const q = useQuery({
    queryKey: ["charge-catalog", "active"],
    queryFn: () => listChargeCatalog({ activeOnly: true }),
    staleTime: 5 * 60 * 1000,
  });
  const rows: ChargeCatalogRow[] = q.data ?? [];
  const labels = rows.map((r) => r.label);
  let values = labels.length > 0 ? labels : fallback;
  if (!values.some((v) => v.toLowerCase() === "other")) {
    values = [...values, "Other"];
  }
  const modeFor = (label: string): ChargeApplicationMode => {
    const row = rows.find((r) => r.label.toLowerCase() === label.toLowerCase());
    if (row?.application_mode) return row.application_mode;
    return PER_ROOM_HEURISTIC.has(label.toLowerCase()) ? "per_room" : "per_booking";
  };
  return { values, rows, modeFor, isLoading: q.isLoading };
}
