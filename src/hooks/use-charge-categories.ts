import { useQuery } from "@tanstack/react-query";
import { listChargeCatalog, type ChargeCatalogRow } from "@/lib/charge-catalog-api";

const FALLBACK = [
  "Water Bottle", "Soft Drinks", "Food Order", "Laundry", "Extra Bed",
  "Early Check-in", "Late Check-out", "Extra Adult", "Extra Pet",
  "Transportation", "Printing Charges", "Dental Kit", "Shaving Kit",
  "Coffee", "Tea", "Other",
];

/**
 * Single source of truth for guest-chargeable item labels.
 * Reads from `charge_catalog` (Operations → Charge Catalog).
 * The free-text "Other" entry is preserved as the escape hatch and is
 * always appended last if not already present in the catalog.
 *
 * Returns string labels to remain backward-compatible with existing
 * `booking_charges.category` rows and reports.
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
  return { values, rows, isLoading: q.isLoading };
}
