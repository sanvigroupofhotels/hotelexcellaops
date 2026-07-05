/**
 * "Working As" picker for the housekeeping task screen.
 *
 * On a shared handset, the logged-in user is the *recorder* — the person
 * holding the phone — but the task might actually be performed by another
 * team member. This hook returns the picker's candidate list (logged-in user
 * first, then every active housekeeping / fo_staff user by name) and
 * persists the current choice in sessionStorage, keyed by the logged-in
 * user's id so device sharing is safe. Cleared on logout / tab close.
 */
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStaff } from "@/hooks/use-current-staff";

export interface WorkingAsUser {
  id: string;
  name: string;
}

interface CandidateRow {
  id: string;
  display_name: string | null;
  username: string | null;
  email: string | null;
}

function displayNameFor(r: CandidateRow): string {
  return (r.display_name && r.display_name.trim())
    || (r.username && r.username.trim())
    || (r.email && r.email.split("@")[0])
    || "user";
}

export function useHkWorkingAs() {
  const { id: myId, name: myName } = useCurrentStaff();
  const [selectedId, setSelectedIdState] = useState<string | null>(null);

  // Candidates: current user + all housekeeping/fo_staff role users, active only.
  const { data: candidates = [] } = useQuery<WorkingAsUser[]>({
    queryKey: ["hk-working-as-candidates", myId],
    queryFn: async () => {
      const { data: roleRows } = await supabase
        .from("user_roles" as any)
        .select("user_id, role")
        .in("role", ["housekeeping", "fo_staff", "staff", "reception"]);
      const ids = Array.from(new Set(((roleRows ?? []) as any[]).map((r) => r.user_id)));
      if (myId && !ids.includes(myId)) ids.unshift(myId);
      if (ids.length === 0) return myId ? [{ id: myId, name: myName || "You" }] : [];
      const { data: profiles } = await supabase
        .from("profiles" as any)
        .select("id, display_name, username, email")
        .in("id", ids);
      const rows = ((profiles ?? []) as any[]) as CandidateRow[];
      const list: WorkingAsUser[] = rows.map((p) => ({ id: p.id, name: displayNameFor(p) }));
      // Sort: logged-in first, then alphabetical.
      list.sort((a, b) => {
        if (myId && a.id === myId) return -1;
        if (myId && b.id === myId) return 1;
        return a.name.localeCompare(b.name);
      });
      return list;
    },
    enabled: !!myId,
    staleTime: 60_000,
  });

  const storageKey = myId ? `hk_working_as:${myId}` : null;

  // Load persisted choice on mount / when myId resolves.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const v = window.sessionStorage.getItem(storageKey);
      if (v) setSelectedIdState(v);
      else if (myId) setSelectedIdState(myId);
    } catch { if (myId) setSelectedIdState(myId); }
  }, [storageKey, myId]);

  const setSelectedId = useCallback((id: string) => {
    setSelectedIdState(id);
    try { if (storageKey) window.sessionStorage.setItem(storageKey, id); } catch { /* ignore */ }
  }, [storageKey]);

  const selected =
    candidates.find((c) => c.id === selectedId)
    ?? (myId ? { id: myId, name: myName || "You" } : null);

  return {
    candidates,
    selected,
    setSelectedId,
  };
}
