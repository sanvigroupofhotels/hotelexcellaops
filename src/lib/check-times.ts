/**
 * Hotel Check-In / Check-Out time helper.
 *
 * Reads from app_settings.ops (see app-settings-api.ts) and caches the values
 * in module scope so synchronous message builders (WhatsApp / Email / PDFs)
 * can read formatted labels without async plumbing.
 *
 * - hydrateOpsTimes()      — kicks off the fetch (called on import + by hook).
 * - getOpsTimeLabels()     — sync, returns formatted "1:00 PM" / "11:00 AM".
 * - useOpsTimeLabels()     — React hook (TanStack Query) for reactive UI.
 */
import { useQuery } from "@tanstack/react-query";
import { getOpsSettings, DEFAULT_OPS } from "@/lib/app-settings-api";
import { formatHotelTime } from "@/lib/time-format";

type Labels = { checkIn: string; checkOut: string; checkInRaw: string; checkOutRaw: string };

let cache: Labels = format(DEFAULT_OPS.check_in_time, DEFAULT_OPS.check_out_time);
let hydrated = false;
let inflight: Promise<Labels> | null = null;

function format(inT: string, outT: string): Labels {
  return {
    checkIn: formatHotelTime(inT),
    checkOut: formatHotelTime(outT),
    checkInRaw: inT,
    checkOutRaw: outT,
  };
}

export function getOpsTimeLabels(): Labels {
  if (!hydrated) void hydrateOpsTimes();
  return cache;
}

export async function hydrateOpsTimes(): Promise<Labels> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const s = await getOpsSettings();
      cache = format(s.check_in_time || DEFAULT_OPS.check_in_time, s.check_out_time || DEFAULT_OPS.check_out_time);
      hydrated = true;
    } catch {/* keep defaults */}
    return cache;
  })();
  try { return await inflight; } finally { inflight = null; }
}

export function useOpsTimeLabels(enabled = true): Labels {
  const { data } = useQuery({
    queryKey: ["ops-time-labels"],
    queryFn: async () => hydrateOpsTimes(),
    enabled,
    staleTime: 5 * 60 * 1000,
    initialData: cache,
  });
  return data;
}
