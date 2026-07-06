import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Topbar } from "@/components/topbar";
import { useUserRole, ROLE_LABEL, ACTIVE_ROLES, type AppRole } from "@/hooks/use-role";
import { setUserRole } from "@/lib/users-admin-api";
import {
  listUsersFn, createUserFn, updateUserFn, setUserActiveFn,
  resetUserPasswordFn, deleteUserFn,
} from "@/lib/users-admin.functions";
import { useAuth } from "@/lib/auth";
import {
  Loader2, ShieldCheck, User as UserIcon, UserPlus, KeyRound, Pencil, Trash2, Power, AtSign,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/users/management")({
  component: UsersPage,
});

interface Row {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  role: AppRole;
  active: boolean;
  created_at: string;
}

function roleColor(r: AppRole) {
  switch (r) {
    case "admin": return "border-gold/40 bg-gold-soft text-gold";
    case "owner": return "border-blue-500/40 bg-blue-500/10 text-blue-400";
    case "fo_staff": return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
    case "housekeeping": return "border-cyan-500/40 bg-cyan-500/10 text-cyan-400";
  }
}

function UsersPage() {
  const { isAdmin, isLoading: roleLoading } = useUserRole();
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const list = useServerFn(listUsersFn);
  const create = useServerFn(createUserFn);
  const update = useServerFn(updateUserFn);
  const setActive = useServerFn(setUserActiveFn);
  const resetPw = useServerFn(resetUserPasswordFn);
  const del = useServerFn(deleteUserFn);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => list() as Promise<Row[]>,
    enabled: isAdmin,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [resetting, setResetting] = useState<Row | null>(null);

  if (roleLoading) {
    return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  }
  if (!isAdmin) return <Navigate to="/" />;

  return (
    <>
      <Topbar title="User Management" subtitle="Admin-only: create, edit, deactivate or reset staff users" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1200px] space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-muted-foreground">
            Manage user accounts here. Roles and the permission matrix are configured in{" "}
            <a className="text-gold underline-offset-2 hover:underline" href="/users/roles">Role Management</a>;
            per-user overrides live in{" "}
            <a className="text-gold underline-offset-2 hover:underline" href="/users/access">Access Management</a>.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-md gold-gradient px-3 py-1.5 text-xs font-medium text-charcoal hover:shadow-[0_0_18px_oklch(0.82_0.13_82/0.35)]"
          >
            <UserPlus className="h-3.5 w-3.5" /> New User
          </button>
        </div>

        <div className="luxe-card rounded-xl overflow-hidden">
          <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border bg-secondary/30">
            <div className="col-span-5">User</div>
            <div className="col-span-3">Role</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          {isLoading && <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>}
          {users.map((u) => {
            const self = u.id === me?.id;
            return (
              <div key={u.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 px-4 md:px-6 py-4 border-b border-border/60 last:border-0">
                <div className="md:col-span-5">
                  <div className="text-sm font-medium flex items-center gap-2">
                    {u.display_name || u.username || "—"}
                    {self && <span className="text-[10px] text-gold">(you)</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                    {u.username ? (
                      <>
                        <AtSign className="h-3 w-3 opacity-60" />
                        <span className="text-foreground/80">{u.username}</span>
                      </>
                    ) : (
                      <span className="italic opacity-60">no username</span>
                    )}
                  </div>
                </div>
                <div className="md:col-span-3 flex items-center">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs border",
                    roleColor(u.role),
                  )}>
                    {u.role === "admin" ? <ShieldCheck className="h-3 w-3" /> : <UserIcon className="h-3 w-3" />}
                    {ROLE_LABEL[u.role]}
                  </span>
                </div>
                <div className="md:col-span-2 flex items-center">
                  <span className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs border",
                    u.active ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive",
                  )}>{u.active ? "Active" : "Deactivated"}</span>
                </div>
                <div className="md:col-span-2 flex justify-end gap-1.5 flex-wrap">
                  <button title="Edit user (role · status · delete)"
                    onClick={() => setEditing(u)}
                    className="inline-flex items-center gap-1 text-xs rounded-md border border-border bg-card px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                  <button title="Reset password" onClick={() => setResetting(u)}
                    className="inline-flex items-center gap-1 text-xs rounded-md border border-border bg-card px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
                    <KeyRound className="h-3 w-3" /> Password
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onSubmit={async (vals) => {
            if (!/^[a-z0-9._-]{3,32}$/.test(vals.username)) {
              toast.error("Username must be 3-32 characters using a-z, 0-9, dot, underscore or dash.");
              return;
            }
            try { await create({ data: vals as any }); toast.success("User created"); invalidate(); setShowCreate(false); }
            catch (e: any) { toast.error(e.message); }
          }}
        />
      )}
      {editing && (
        <EditUserModal
          user={editing}
          isSelf={editing.id === me?.id}
          onClose={() => setEditing(null)}
          onSaveFields={async (vals) => {
            if (vals.username && !/^[a-z0-9._-]{3,32}$/.test(vals.username)) {
              toast.error("Username must be 3-32 characters using a-z, 0-9, dot, underscore or dash.");
              return false;
            }
            try {
              await update({ data: { id: editing.id, ...vals } as any });
              invalidate();
              return true;
            } catch (e: any) { toast.error(e.message); return false; }
          }}
          onChangeRole={async (role) => {
            try { await setUserRole(editing.id, role); toast.success("Role updated"); invalidate(); }
            catch (e: any) { toast.error(e.message); }
          }}
          onToggleActive={async (active) => {
            try { await setActive({ data: { id: editing.id, active } }); toast.success(active ? "User activated" : "User deactivated"); invalidate(); }
            catch (e: any) { toast.error(e.message); }
          }}
          onDelete={async () => {
            if (!confirm(`Delete ${editing.display_name || editing.username || editing.email}? This cannot be undone.`)) return;
            try { await del({ data: { id: editing.id } }); toast.success("User deleted"); invalidate(); setEditing(null); }
            catch (e: any) { toast.error(e.message); }
          }}
        />
      )}
      {resetting && (
        <ResetPasswordModal user={resetting} onClose={() => setResetting(null)}
          onSubmit={async (pw: string) => {
            try { await resetPw({ data: { id: resetting.id, new_password: pw } }); toast.success("Password reset"); setResetting(null); }
            catch (e: any) { toast.error(e.message); }
          }}
        />
      )}
    </>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="luxe-card rounded-xl p-5 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, ...props }: any) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <input {...props} className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
      {hint && <span className="block text-[10px] text-muted-foreground/80">{hint}</span>}
    </label>
  );
}

function CreateUserModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (v: { username: string; email: string; password: string; display_name: string; role: AppRole }) => void }) {
  const [v, setV] = useState({
    username: "",
    email: "",
    password: "",
    display_name: "",
    role: "housekeeping" as AppRole,
  });
  return (
    <Modal title="Create User" onClose={onClose}>
      <Field label="Display Name" value={v.display_name} onChange={(e: any) => setV({ ...v, display_name: e.target.value })} />
      <Field
        label="Username (primary identity)"
        value={v.username}
        autoCapitalize="none"
        autoCorrect="off"
        hint="Users sign in with this. Any characters allowed."
        onChange={(e: any) => setV({ ...v, username: e.target.value.trim() })}
      />
      <Field
        label="Email (optional)"
        type="email"
        value={v.email}
        hint="For password reset only. Leave blank to auto-generate <username>@hotelexcella.in"
        onChange={(e: any) => setV({ ...v, email: e.target.value })}
      />
      <Field label="Initial Password" type="password" autoComplete="new-password" value={v.password} onChange={(e: any) => setV({ ...v, password: e.target.value })} />
      <label className="block space-y-1">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Role</span>
        <select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as AppRole })}
          className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
          {ACTIVE_ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="text-xs rounded-md border border-border bg-card px-3 py-1.5">Cancel</button>
        <button onClick={() => onSubmit(v)} className="text-xs rounded-md gold-gradient px-3 py-1.5 font-medium text-charcoal">Create</button>
      </div>
    </Modal>
  );
}

/**
 * Edit modal — consolidated per stabilization sprint 2026-07-05.
 * Handles: profile fields, role change, activate/deactivate, delete.
 * Password is intentionally kept as a separate action outside Edit.
 */
function EditUserModal({
  user, isSelf, onClose, onSaveFields, onChangeRole, onToggleActive, onDelete,
}: {
  user: Row;
  isSelf: boolean;
  onClose: () => void;
  onSaveFields: (v: { display_name: string; email: string; username: string }) => Promise<boolean>;
  onChangeRole: (r: AppRole) => Promise<void>;
  onToggleActive: (active: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [v, setV] = useState({
    display_name: user.display_name ?? "",
    email: user.email ?? "",
    username: user.username ?? "",
  });
  const [role, setRole] = useState<AppRole>(user.role);
  const [savingFields, setSavingFields] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [savingActive, setSavingActive] = useState(false);

  async function saveFields() {
    setSavingFields(true);
    const ok = await onSaveFields(v);
    setSavingFields(false);
    if (ok) { toast.success("Profile updated"); }
  }
  async function commitRole() {
    if (role === user.role) return;
    setSavingRole(true);
    await onChangeRole(role);
    setSavingRole(false);
  }

  return (
    <Modal title={`Edit — ${user.display_name || user.username || "user"}`} onClose={onClose}>
      {/* ── Profile ── */}
      <section className="space-y-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Profile</div>
        <Field label="Display Name" value={v.display_name} onChange={(e: any) => setV({ ...v, display_name: e.target.value })} />
        <Field
          label="Username"
          value={v.username}
          autoCapitalize="none"
          autoCorrect="off"
          hint="Primary identity; used at sign-in"
          onChange={(e: any) => setV({ ...v, username: e.target.value.toLowerCase().trim() })}
        />
        <Field
          label="Email"
          type="email"
          value={v.email}
          hint="Optional — leave blank to keep auto-generated login email hidden"
          onChange={(e: any) => setV({ ...v, email: e.target.value })}
        />
        <div className="flex justify-end">
          <button onClick={saveFields} disabled={savingFields}
            className="text-xs rounded-md gold-gradient px-3 py-1.5 font-medium text-charcoal disabled:opacity-50">
            {savingFields ? "Saving…" : "Save Profile"}
          </button>
        </div>
      </section>

      <div className="border-t border-border/60" />

      {/* ── Role ── */}
      <section className="space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Role</div>
        <div className="flex items-center gap-2">
          <select
            value={role}
            disabled={isSelf || savingRole}
            onChange={(e) => setRole(e.target.value as AppRole)}
            className="flex-1 bg-input/60 border border-border rounded-md px-3 py-2 text-sm disabled:opacity-50"
          >
            {ACTIVE_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
          <button
            onClick={commitRole}
            disabled={isSelf || savingRole || role === user.role}
            className="text-xs rounded-md border border-gold/40 bg-gold-soft text-gold px-3 py-1.5 disabled:opacity-40"
          >
            {savingRole ? "…" : "Apply"}
          </button>
        </div>
        {isSelf && <p className="text-[10px] text-muted-foreground">You can't change your own role.</p>}
      </section>

      <div className="border-t border-border/60" />

      {/* ── Danger zone ── */}
      <section className="space-y-3">
        <div className="text-[10px] uppercase tracking-wider text-destructive/80">Danger Zone</div>
        <div className="flex items-center gap-2">
          <button
            disabled={isSelf || savingActive}
            onClick={async () => { setSavingActive(true); await onToggleActive(!user.active); setSavingActive(false); }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs rounded-md border border-border bg-card px-3 py-2 hover:bg-muted/60 disabled:opacity-40"
          >
            <Power className="h-3.5 w-3.5" />
            {user.active ? "Deactivate" : "Activate"} user
          </button>
          <button
            disabled={isSelf}
            onClick={onDelete}
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2 hover:bg-destructive/20 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete user
          </button>
        </div>
        {isSelf && <p className="text-[10px] text-muted-foreground">You can't deactivate or delete yourself.</p>}
      </section>

      <div className="flex justify-end pt-1">
        <button onClick={onClose} className="text-xs rounded-md border border-border bg-card px-3 py-1.5">Close</button>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onSubmit }: any) {
  const [pw, setPw] = useState("");
  return (
    <Modal title={`Reset password — ${user.display_name || user.username || user.email}`} onClose={onClose}>
      <Field label="New Password" type="password" autoComplete="new-password" value={pw} onChange={(e: any) => setPw(e.target.value)} />
      <p className="text-[11px] text-muted-foreground">Share this password with the user securely. They can change it after sign-in.</p>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="text-xs rounded-md border border-border bg-card px-3 py-1.5">Cancel</button>
        <button onClick={() => onSubmit(pw)} disabled={pw.length < 8} className="text-xs rounded-md gold-gradient px-3 py-1.5 font-medium text-charcoal disabled:opacity-40">Reset</button>
      </div>
    </Modal>
  );
}
