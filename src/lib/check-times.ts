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

type Labels = { checkIn: string; checkOut: string; checkInRaw: string; checkOutRaw: string };

let cache: Labels = format(DEFAULT_OPS.check_in_time, DEFAULT_OPS.check_out_time);
let hydrated = false;
let inflight: Promise<Labels> | null = null;

function to12h(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || "");
  if (!m) return hhmm;
  let h = Number(m[1]); const mm = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${mm} ${ampm}`;
}

function format(inT: string, outT: string): Labels {
  return { checkIn: to12h(inT), checkOut: to12h(outT), checkInRaw: inT, checkOutRaw: outT };
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

export function useOpsTimeLabels(): Labels {
  const { data } = useQuery({
    queryKey: ["ops-time-labels"],
    queryFn: async () => hydrateOpsTimes(),
    staleTime: 5 * 60 * 1000,
    initialData: cache,
  });
  return data;
}

// Kick off on import so message builders have fresh values by first call.
void hydrateOpsTimes();
