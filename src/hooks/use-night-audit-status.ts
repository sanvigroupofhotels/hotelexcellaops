/**
 * Lightweight hook used by the sidebar/header to display Business Date,
 * current session status, and pending action count.
 *
 * Polls every 60s; also pulls from the standard react-query cache so other
 * Night Audit interactions (open/close session, check-in) refresh it.
 */
import { useQuery } from "@tanstack/react-query";
import { getPendingForAudit } from "@/lib/night-audit-api";
import { getOpenSession } from "@/lib/night-audit-sessions-api";

export interface NightAuditStatus {
  businessDate: string;
  sessionStatus: "open" | "none";
  pendingCount: number;
}

export function useNightAuditStatus() {
  return useQuery<NightAuditStatus>({
    queryKey: ["night-audit-status"],
    queryFn: async () => {
      const { businessDate, pendingCheckIns, pendingCheckOuts } =
        await getPendingForAudit();
      const session = await getOpenSession(businessDate).catch(() => null);
      return {
        businessDate,
        sessionStatus: session ? "open" : "none",
        pendingCount: pendingCheckIns.length + pendingCheckOuts.length,
      };
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
