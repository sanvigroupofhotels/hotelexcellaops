import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { useUserRole } from "@/hooks/use-role";
import {
  listRoles, listPermissions, listRolePermissions, togglePermission,
  createRole, updateRole, deleteRole, type Role, type Permission,
} from "@/lib/access-api";
import { Loader2, Plus, Trash2, ShieldCheck, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/access-settings")({
  component: AccessSettingsPage,
});

function AccessSettingsPage() {
  const { isAdmin, isLoading: roleLoading } = useUserRole();
  const qc = useQueryClient();

  const rolesQ = useQuery({ queryKey: ["access-roles"], queryFn: listRoles, enabled: isAdmin });
  const permsQ = useQuery({ queryKey: ["access-perms"], queryFn: listPermissions, enabled: isAdmin });
  const matrixQ = useQuery({ queryKey: ["access-matrix"], queryFn: listRolePermissions, enabled: isAdmin });

  const grantedSet = useMemo(() => {
    const s = new Set<string>();
    for (const rp of matrixQ.data ?? []) s.add(`${rp.role_key}::${rp.permission_key}`);
    return s;
  }, [matrixQ.data]);

  const toggleMut = useMutation({
    mutationFn: ({ role_key, permission_key, granted }: { role_key: string; permission_key: string; granted: boolean }) =>
      togglePermission(role_key, permission_key, granted),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["access-matrix"] });
      const prev = qc.getQueryData<any[]>(["access-matrix"]) ?? [];
      const next = vars.granted
        ? [...prev, { role_key: vars.role_key, permission_key: vars.permission_key }]
        : prev.filter((r: any) => !(r.role_key === vars.role_key && r.permission_key === vars.permission_key));
      qc.setQueryData(["access-matrix"], next);
      return { prev };
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["access-matrix"], ctx.prev);
      toast.error(e.message ?? "Failed to update permission");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["access-matrix"] }),
  });

  const [showNewRole, setShowNewRole] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  const createMut = useMutation({
    mutationFn: createRole,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["access-roles"] }); toast.success("Role created"); setShowNewRole(false); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, patch }: any) => updateRole(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["access-roles"] }); toast.success("Role updated"); setEditingRole(null); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["access-roles"] }); qc.invalidateQueries({ queryKey: ["access-matrix"] }); toast.success("Role deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  if (roleLoading) return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  if (!isAdmin) return <Navigate to="/" />;

  const roles = rolesQ.data ?? [];
  const perms = permsQ.data ?? [];

  // Group permissions by module
  const modules = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of perms) {
      if (!map.has(p.module)) map.set(p.module, []);
      map.get(p.module)!.push(p);
    }
    return Array.from(map.entries());
  }, [perms]);

  const loading = rolesQ.isLoading || permsQ.isLoading || matrixQ.isLoading;

  return (
    <>
      <Topbar title="Access Settings" subtitle="Configure role-based permissions across all modules" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-muted-foreground">
            Toggle a checkbox to grant or revoke a permission for a role. Changes apply on the next page load for affected users.
          </p>
          <button
            onClick={() => setShowNewRole(true)}
            className="inline-flex items-center gap-1.5 rounded-md gold-gradient px-3 py-1.5 text-xs font-medium text-charcoal"
          >
            <Plus className="h-3.5 w-3.5" /> New Role
          </button>
        </div>

        {/* Roles summary strip */}
        <div className="luxe-card rounded-xl p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Roles</div>
          <div className="flex flex-wrap gap-2">
            {roles.map((r) => (
              <div key={r.id} className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs border",
                r.is_system ? "border-gold/40 bg-gold-soft text-gold" : "border-blue-500/40 bg-blue-500/10 text-blue-400",
              )}>
                <ShieldCheck className="h-3 w-3" />
                {r.label}
                {!r.is_system && (
                  <>
                    <button title="Edit" onClick={() => setEditingRole(r)} className="ml-1 opacity-70 hover:opacity-100">
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button title="Delete" onClick={() => { if (confirm(`Delete role "${r.label}"? Assigned users will lose this role.`)) deleteMut.mutate(r.id); }} className="opacity-70 hover:opacity-100">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : (
          <div className="luxe-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/30 border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground sticky left-0 bg-secondary/30 z-10">
                      Module / Permission
                    </th>
                    {roles.map((r) => (
                      <th key={r.key} className="text-center px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground min-w-[120px]">
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {modules.map(([mod, modPerms]) => (
                    <Group key={mod} mod={mod} perms={modPerms} roles={roles} grantedSet={grantedSet}
                      onToggle={(role_key, permission_key, granted) => toggleMut.mutate({ role_key, permission_key, granted })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showNewRole && (
        <RoleModal title="New Role" onClose={() => setShowNewRole(false)}
          onSubmit={(v) => createMut.mutate(v as any)} />
      )}
      {editingRole && (
        <RoleModal title={`Edit ${editingRole.label}`} initial={editingRole} onClose={() => setEditingRole(null)}
          onSubmit={(v) => updateMut.mutate({ id: editingRole.id, patch: { label: v.label, description: v.description } })} />
      )}
    </>
  );
}

function Group({
  mod, perms, roles, grantedSet, onToggle,
}: {
  mod: string;
  perms: Permission[];
  roles: Role[];
  grantedSet: Set<string>;
  onToggle: (role_key: string, permission_key: string, granted: boolean) => void;
}) {
  return (
    <>
      <tr className="bg-muted/20">
        <td colSpan={1 + roles.length} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gold">
          {mod}
        </td>
      </tr>
      {perms.map((p) => (
        <tr key={p.key} className="border-b border-border/40">
          <td className="px-4 py-2.5 sticky left-0 bg-card">
            <div className="text-sm">{p.label}</div>
            {p.description && <div className="text-[11px] text-muted-foreground">{p.description}</div>}
            <div className="text-[10px] text-muted-foreground/60 font-mono">{p.key}</div>
          </td>
          {roles.map((r) => {
            const granted = grantedSet.has(`${r.key}::${p.key}`);
            return (
              <td key={r.key} className="px-4 py-2.5 text-center">
                <Checkbox
                  checked={granted}
                  onCheckedChange={(v) => onToggle(r.key, p.key, !!v)}
                />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function RoleModal({ title, initial, onClose, onSubmit }: {
  title: string;
  initial?: Partial<Role>;
  onClose: () => void;
  onSubmit: (v: { key: string; label: string; description?: string }) => void;
}) {
  const [v, setV] = useState({
    key: initial?.key ?? "",
    label: initial?.label ?? "",
    description: initial?.description ?? "",
  });
  const isEdit = !!initial?.id;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="luxe-card rounded-xl p-5 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg">{title}</h3>
        {!isEdit && (
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Role Key (lowercase, e.g. "manager")</span>
            <input value={v.key} onChange={(e) => setV({ ...v, key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })}
              className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm font-mono" />
            <p className="text-[10px] text-muted-foreground">Note: new role keys must also be added to the user_roles enum by an engineer before users can be assigned this role. The permission matrix is configured here in advance.</p>
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Label</span>
          <input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })}
            className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Description</span>
          <input value={v.description ?? ""} onChange={(e) => setV({ ...v, description: e.target.value })}
            className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-xs rounded-md border border-border bg-card px-3 py-1.5">Cancel</button>
          <button
            disabled={!v.label || (!isEdit && !v.key)}
            onClick={() => onSubmit(v)}
            className="text-xs rounded-md gold-gradient px-3 py-1.5 font-medium text-charcoal disabled:opacity-40">
            {isEdit ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
