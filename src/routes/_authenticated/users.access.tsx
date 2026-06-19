import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Topbar } from "@/components/topbar";
import { useUserRole, type AppRole } from "@/hooks/use-role";
import { listUsersFn } from "@/lib/users-admin.functions";
import {
  listPermissions, listRolePermissions, listAllUserOverrides,
  setUserOverride, clearUserOverride, type Permission, type UserPermissionOverride,
} from "@/lib/access-api";
import { Loader2, KeyRound, ShieldCheck, Check, X, RotateCcw, Search, Clock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Access Management — per-user permission overrides.
 *
 * For the selected user we compute the effective permission state for every
 * permission in the system: (1) role-default (inherited from any user_roles
 * row); (2) user override (granted=true | granted=false) which wins over the
 * role default; (3) optional expiry on the override.
 *
 *   Final state = role default ⊕ override
 *
 * Admin actions on a row:
 *   - "Allow"   → upsert override granted=true   (forces ON even if role says OFF)
 *   - "Deny"    → upsert override granted=false  (forces OFF even if role says ON)
 *   - "Reset"   → delete override                (back to role default)
 */
export const Route = createFileRoute("/_authenticated/users/access")({
  component: AccessOverridesPage,
});

interface UserRow { id: string; email: string | null; display_name: string | null; role: AppRole; active: boolean }

function AccessOverridesPage() {
  const { isAdmin, isLoading: roleLoading } = useUserRole();
  const qc = useQueryClient();
  const listUsers = useServerFn(listUsersFn);

  const usersQ = useQuery({ queryKey: ["admin-users-access"], queryFn: () => listUsers() as Promise<UserRow[]>, enabled: isAdmin });
  const permsQ = useQuery({ queryKey: ["access-perms"], queryFn: listPermissions, enabled: isAdmin });
  const matrixQ = useQuery({ queryKey: ["access-matrix"], queryFn: listRolePermissions, enabled: isAdmin });
  const overridesQ = useQuery({ queryKey: ["access-overrides"], queryFn: listAllUserOverrides, enabled: isAdmin });

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const users = usersQ.data ?? [];
  const perms = permsQ.data ?? [];
  const matrix = matrixQ.data ?? [];
  const overrides = overridesQ.data ?? [];

  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;

  // Role -> set of permission keys
  const roleGrants = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const rp of matrix) {
      if (!m.has(rp.role_key)) m.set(rp.role_key, new Set());
      m.get(rp.role_key)!.add(rp.permission_key);
    }
    return m;
  }, [matrix]);

  // user -> permission_key -> override
  const userOverrideMap = useMemo(() => {
    const m = new Map<string, Map<string, UserPermissionOverride>>();
    for (const o of overrides) {
      if (!m.has(o.user_id)) m.set(o.user_id, new Map());
      m.get(o.user_id)!.set(o.permission_key, o);
    }
    return m;
  }, [overrides]);

  const setMut = useMutation({
    mutationFn: setUserOverride,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["access-overrides"] }); qc.invalidateQueries({ queryKey: ["my-permissions"] }); },
    onError: (e: any) => toast.error(e.message ?? "Failed to update override"),
  });
  const clearMut = useMutation({
    mutationFn: ({ user_id, permission_key }: { user_id: string; permission_key: string }) =>
      clearUserOverride(user_id, permission_key),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["access-overrides"] }); qc.invalidateQueries({ queryKey: ["my-permissions"] }); },
    onError: (e: any) => toast.error(e.message ?? "Failed to clear override"),
  });

  if (roleLoading) return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  if (!isAdmin) return <Navigate to="/" />;

  const modules = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of perms) {
      if (filter && !`${p.module} ${p.label} ${p.key}`.toLowerCase().includes(filter.toLowerCase())) continue;
      if (!map.has(p.module)) map.set(p.module, []);
      map.get(p.module)!.push(p);
    }
    return Array.from(map.entries());
  }, [perms, filter]);

  const usersSorted = [...users].sort((a, b) =>
    (a.display_name ?? a.email ?? "").localeCompare(b.display_name ?? b.email ?? ""),
  );

  return (
    <>
      <Topbar title="Access Management" subtitle="Grant or revoke specific permissions for an individual user — overrides the role default." />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1500px] space-y-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <KeyRound className="h-3.5 w-3.5 text-gold" />
          Pick a user, then Allow / Deny / Reset any permission. Overrides take precedence over role defaults.
          <Link to="/users/roles" className="ml-auto inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold-soft/30 px-2 py-1 hover:bg-gold-soft/50">
            <ShieldCheck className="h-3 w-3" /> Manage Roles
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* User picker */}
          <div className="luxe-card rounded-xl p-3 space-y-1.5 max-h-[70vh] overflow-y-auto">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground px-1.5 pb-1">Users</div>
            {usersQ.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-gold mx-auto my-6" /> :
              usersSorted.map((u) => {
                const overrideCount = userOverrideMap.get(u.id)?.size ?? 0;
                const isSel = u.id === selectedUserId;
                return (
                  <button key={u.id} onClick={() => setSelectedUserId(u.id)}
                    className={cn(
                      "w-full text-left px-2.5 py-2 rounded-md border transition text-xs",
                      isSel ? "border-gold/40 bg-gold-soft/40" : "border-transparent hover:bg-muted/40",
                    )}>
                    <div className="font-medium truncate">{u.display_name || u.email}</div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                      <span className="capitalize">{u.role}</span>
                      {overrideCount > 0 && <span className="rounded-full px-1.5 py-px bg-blue-500/20 text-blue-400">{overrideCount} override{overrideCount === 1 ? "" : "s"}</span>}
                      {!u.active && <span className="rounded-full px-1.5 py-px bg-destructive/20 text-destructive">inactive</span>}
                    </div>
                  </button>
                );
              })}
          </div>

          {/* Permission matrix */}
          <div className="luxe-card rounded-xl overflow-hidden">
            {!selectedUser ? (
              <div className="p-10 text-center text-sm text-muted-foreground">Select a user to view and edit their permissions.</div>
            ) : (
              <>
                <div className="p-4 border-b border-border bg-secondary/20 flex flex-wrap items-center gap-3">
                  <div>
                    <div className="font-medium">{selectedUser.display_name || selectedUser.email}</div>
                    <div className="text-[11px] text-muted-foreground">Role: <span className="capitalize text-foreground">{selectedUser.role}</span> · {selectedUser.email}</div>
                  </div>
                  <div className="ml-auto relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter permissions…"
                      className="pl-7 pr-2 py-1.5 text-xs rounded-md border border-border bg-input/60 w-56" />
                  </div>
                </div>

                <div className="max-h-[68vh] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/20 border-b border-border sticky top-0 z-10">
                      <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="text-left px-4 py-2">Permission</th>
                        <th className="text-center px-3 py-2 w-28">Role default</th>
                        <th className="text-center px-3 py-2 w-28">Effective</th>
                        <th className="text-right px-3 py-2 w-[260px]">Override</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modules.map(([mod, modPerms]) => (
                        <ModuleRows key={mod} mod={mod} perms={modPerms}
                          roleGrants={roleGrants.get(selectedUser.role) ?? new Set()}
                          overrideForKey={(k) => userOverrideMap.get(selectedUser.id)?.get(k)}
                          onAllow={(k) => setMut.mutate({ user_id: selectedUser.id, permission_key: k, granted: true })}
                          onDeny={(k) => setMut.mutate({ user_id: selectedUser.id, permission_key: k, granted: false })}
                          onReset={(k) => clearMut.mutate({ user_id: selectedUser.id, permission_key: k })}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ModuleRows({
  mod, perms, roleGrants, overrideForKey, onAllow, onDeny, onReset,
}: {
  mod: string;
  perms: Permission[];
  roleGrants: Set<string>;
  overrideForKey: (k: string) => UserPermissionOverride | undefined;
  onAllow: (k: string) => void;
  onDeny: (k: string) => void;
  onReset: (k: string) => void;
}) {
  return (
    <>
      <tr className="bg-muted/15">
        <td colSpan={4} className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gold">{mod}</td>
      </tr>
      {perms.map((p) => {
        const roleHas = roleGrants.has(p.key);
        const ov = overrideForKey(p.key);
        const expired = ov?.expires_at && new Date(ov.expires_at) <= new Date();
        const effective = ov && !expired ? ov.granted : roleHas;

        return (
          <tr key={p.key} className="border-b border-border/40">
            <td className="px-4 py-2">
              <div className="text-sm">{p.label}</div>
              {p.description && <div className="text-[10px] text-muted-foreground">{p.description}</div>}
              <div className="text-[10px] text-muted-foreground/60 font-mono">{p.key}</div>
            </td>
            <td className="px-3 py-2 text-center">
              <StatePill on={roleHas} muted />
            </td>
            <td className="px-3 py-2 text-center">
              <StatePill on={!!effective} />
              {ov?.expires_at && !expired && (
                <div className="mt-0.5 text-[9px] text-muted-foreground inline-flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" /> until {new Date(ov.expires_at).toLocaleDateString()}
                </div>
              )}
            </td>
            <td className="px-3 py-2">
              <div className="flex items-center justify-end gap-1">
                <button onClick={() => onAllow(p.key)}
                  className={cn(
                    "inline-flex items-center gap-1 text-[11px] rounded-md px-2 py-1 border transition",
                    ov?.granted === true && !expired
                      ? "border-success/60 bg-success/15 text-success"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}>
                  <Check className="h-3 w-3" /> Allow
                </button>
                <button onClick={() => onDeny(p.key)}
                  className={cn(
                    "inline-flex items-center gap-1 text-[11px] rounded-md px-2 py-1 border transition",
                    ov?.granted === false && !expired
                      ? "border-destructive/60 bg-destructive/15 text-destructive"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}>
                  <X className="h-3 w-3" /> Deny
                </button>
                <button onClick={() => onReset(p.key)} disabled={!ov} title="Back to role default"
                  className="inline-flex items-center gap-1 text-[11px] rounded-md px-2 py-1 border border-border bg-card text-muted-foreground hover:text-foreground disabled:opacity-30">
                  <RotateCcw className="h-3 w-3" /> Reset
                </button>
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function StatePill({ on, muted }: { on: boolean; muted?: boolean }) {
  if (on) return <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]", muted ? "bg-muted/40 text-muted-foreground" : "bg-success/15 text-success")}><Check className="h-2.5 w-2.5" /> ON</span>;
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]", muted ? "bg-muted/30 text-muted-foreground/70" : "bg-destructive/15 text-destructive")}><X className="h-2.5 w-2.5" /> OFF</span>;
}
