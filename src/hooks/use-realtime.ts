import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribe to Supabase Postgres changes and invalidate the given React Query keys.
 * Cleans up the channel on unmount. Safe to mount on multiple pages.
 */
export function useRealtimeInvalidate(
  tables: string[],
  queryKeys: (string | string[])[],
  channelName?: string,
) {
  const qc = useQueryClient();
  useEffect(() => {
    const name = channelName ?? `rt-${tables.join("-")}`;
    const channel = supabase.channel(name);
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
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join("|"), channelName]);
}
