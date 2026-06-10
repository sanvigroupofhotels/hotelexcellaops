import { useQuery } from "@tanstack/react-query";
import { listRoomRates, listRateOverrides } from "@/lib/rates-api";
import { resolveAverageRate } from "@/lib/rates";
import { getRoomRate } from "@/lib/mock-data";

/**
 * Single source of truth for primary room rate, blending:
 *   1. Rates & Inventory date overrides
 *   2. Weekend / Weekday rate from room_rates
 *   3. Default rate from room_rates
 *   4. Legacy hardcoded ROOM_TARIFFS (final fallback)
 *
 * Returns the per-night-average rate over [check_in, check_out).
 * The legacy "breakfast included" toggle still applies on top of the
 * legacy fallback so existing data stays consistent.
 */
export function useResolvedRate(
  room_type: string,
  check_in: string,
  check_out: string,
  breakfast_included: boolean,
): number {
  const { data: rates = [] } = useQuery({ queryKey: ["room-rates"], queryFn: listRoomRates, staleTime: 60_000 });
  const { data: overrides = [] } = useQuery({
    queryKey: ["rate-overrides", check_in, check_out],
    queryFn: () => listRateOverrides({ from: check_in, to: check_out }),
    enabled: !!(check_in && check_out && check_out > check_in),
    staleTime: 30_000,
  });
  if (!check_in || !check_out || check_out <= check_in) return getRoomRate(room_type, breakfast_included);
  const resolved = resolveAverageRate(room_type, check_in, check_out, rates, overrides);
  return resolved ?? getRoomRate(room_type, breakfast_included);
}
