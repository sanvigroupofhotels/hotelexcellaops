import { useQuery } from "@tanstack/react-query";
import { listMasterData, type MasterCategory, type MasterDataRow } from "@/lib/master-data-api";

/**
 * useMasterData('lead_source') → returns active entries (label/value) for that category.
 * `fallback` is used if the table is empty (e.g. during initial deployment).
 */
export function useMasterData(category: MasterCategory | string, fallback: string[] = []) {
  const q = useQuery({
    queryKey: ["master-data", category],
    queryFn: () => listMasterData(category),
    staleTime: 5 * 60 * 1000,
  });
  const rows: MasterDataRow[] = q.data ?? [];
  const active = rows.filter((r) => r.active);
  const values = active.length > 0 ? active.map((r) => r.value) : fallback;
  const labels: Record<string, string> = {};
  for (const r of active) labels[r.value] = r.label;
  return { values, labels, rows, isLoading: q.isLoading };
}
