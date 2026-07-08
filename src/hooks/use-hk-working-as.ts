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
import { useUserRole } from "@/hooks/use-role";

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

// Role priority for the picker order. Admin/owner surface last since they
// are rarely the actual worker.
const ROLE_ORDER: Record<string, number> = {
  housekeeping: 1,
  fo_staff: 2,
  admin: 3,
  owner: 3,
};

export function useHkWorkingAs() {
  const { id: myId, name: myName } = useCurrentStaff();
  const { role: myRole } = useUserRole();
  const [selectedId, setSelectedIdState] = useState<string | null>(null);

  // Role-based visibility (UAT Sprint 2):
  //   - owner/admin : owner/admin (logged-in first) + fo_staff + housekeeping
  //   - fo_staff    : fo_staff (logged-in first) + housekeeping — NO owner/admin
  //   - housekeeping: only housekeeping (logged-in first)
  const roleFilter: string[] =
    myRole === "housekeeping" ? ["housekeeping"]
    : (myRole === "admin" || myRole === "owner") ? ["housekeeping", "fo_staff", "admin", "owner"]
    : ["housekeeping", "fo_staff"];

  const { data: candidates = [] } = useQuery<WorkingAsUser[]>({
    queryKey: ["hk-working-as-candidates", myId, myRole],
    queryFn: async () => {
      const { data: roleRows } = await supabase
        .from("user_roles" as any)
        .select("user_id, role")
        .in("role", roleFilter);
      const bestRole = new Map<string, number>();
      for (const r of ((roleRows ?? []) as any[])) {
        const rank = ROLE_ORDER[r.role] ?? 99;
        const prev = bestRole.get(r.user_id);
        if (prev === undefined || rank < prev) bestRole.set(r.user_id, rank);
      }
      const ids = Array.from(bestRole.keys());
      if (myId && !ids.includes(myId)) { ids.unshift(myId); if (!bestRole.has(myId)) bestRole.set(myId, 99); }
      if (ids.length === 0) return myId ? [{ id: myId, name: myName || "You" }] : [];
      const { data: profiles } = await supabase
        .from("profiles" as any)
        .select("id, display_name, username, email")
        .in("id", ids);
      const rows = ((profiles ?? []) as any[]) as CandidateRow[];
      const list: WorkingAsUser[] = rows.map((p) => ({ id: p.id, name: displayNameFor(p) }));
      // Sort: logged-in first → housekeeping → fo_staff → other, alpha within.
      list.sort((a, b) => {
        if (myId && a.id === myId) return -1;
        if (myId && b.id === myId) return 1;
        const ra = bestRole.get(a.id) ?? 99;
        const rb = bestRole.get(b.id) ?? 99;
        if (ra !== rb) return ra - rb;
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
