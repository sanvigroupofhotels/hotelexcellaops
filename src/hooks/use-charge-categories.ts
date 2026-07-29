import { useQuery } from "@tanstack/react-query";
import { listChargeCatalog, type ChargeCatalogRow, type ChargeApplicationMode } from "@/lib/charge-catalog-api";

const FALLBACK = [
  "Water Bottle", "Soft Drinks", "Food Order", "Laundry", "Extra Bed",
  "Early Check-in", "Late Check-out", "Extra Adult", "Extra Pet",
  "Transportation", "Printing Charges", "Dental Kit", "Shaving Kit",
  "Coffee", "Tea", "Other",
];

/**
 * Labels that default to `per_room` when the catalog row does not have an
 * explicit application_mode configured (e.g. free-text "Other" or fallback
 * seed entries used before an admin curates the catalog).
 */
const PER_ROOM_HEURISTIC = new Set(
  ["early check-in", "early check in", "late check-out", "late check out",
   "extra bed", "extra adult", "extra pet", "extra person", "cleaning fee"]
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
