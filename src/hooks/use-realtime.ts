import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribe to Supabase Postgres changes and invalidate React Query keys.
 *
 * Lifecycle pattern (applied consistently across the app):
 *   1. Register ALL `.on()` listeners BEFORE `.subscribe()`.
 *   2. Use a unique channel topic per mount to prevent duplicate-subscription
 *      errors when the hook is mounted in multiple components simultaneously.
 *   3. Remove the channel on unmount.
 *   4. Wrap subscribe in try/catch so a Realtime failure can never crash
 *      the app — callers should rely on `refetchInterval` / polling for
 *      continuity when Realtime is unavailable.
 */
export function useRealtimeInvalidate(
  tables: string[],
  queryKeys: (string | string[])[],
  channelName?: string,
) {
  const qc = useQueryClient();
  const mountId = useRef(Math.random().toString(36).slice(2, 8));
  useEffect(() => {
    const base = channelName ?? `rt-${tables.join("-")}`;
    const name = `${base}-${mountId.current}`;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(name);
      // Register listeners BEFORE subscribe().
      for (const table of tables) {
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table },
          () => {
            for (const k of queryKeys) {
              qc.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] });
            }
          },
        );
      }
      channel.subscribe((status) => {
        // CHANNEL_ERROR / TIMED_OUT / CLOSED → polling fallback handles it.
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // No-op: callers should keep a polling refetchInterval as fallback.
        }
      });
    } catch (e) {
      // Realtime totally unavailable — never crash the host component.
      console.warn("[realtime] subscribe failed", e);
    }
    return () => {
      if (channel) {
        try { supabase.removeChannel(channel); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join("|"), channelName]);
}
