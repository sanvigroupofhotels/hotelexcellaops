import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Topbar } from "@/components/topbar";
import { useUserRole, type AppRole } from "@/hooks/use-role";
import { setUserRole } from "@/lib/users-admin-api";
import {
  listUsersFn, createUserFn, updateUserFn, setUserActiveFn,
  resetUserPasswordFn, deleteUserFn,
} from "@/lib/users-admin.functions";
import { useAuth } from "@/lib/auth";
import {
  Loader2, ShieldCheck, User as UserIcon, UserPlus, KeyRound, Power, Trash2, Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/users")({
  component: UsersPage,
});

interface Row {
  id: string;
  email: string | null;
  display_name: string | null;
  role: AppRole;
  active: boolean;
  created_at: string;
}

const ROLE_LABEL: Record<AppRole, string> = { admin: "Admin", owner: "Owner", staff: "Staff" };

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

  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: AppRole }) => setUserRole(id, role),
    onSuccess: () => { invalidate(); toast.success("Role updated"); },
    onError: (e: any) => toast.error(e.message),
  });
  const activeMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setActive({ data: { id, active } }),
    onSuccess: (_d, v) => { invalidate(); toast.success(v.active ? "User activated" : "User deactivated"); },
    onError: (e: any) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { invalidate(); toast.success("User deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

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
            Staff see only Quotes, Customers, Tasks, Follow-ups & Calendar. Admins see everything including this page.
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
            <div className="col-span-4">User</div>
            <div className="col-span-2">Role</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-4 text-right">Actions</div>
          </div>
          {isLoading && <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>}
          {users.map((u) => {
            const self = u.id === me?.id;
            return (
              <div key={u.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 px-4 md:px-6 py-4 border-b border-border/60 last:border-0">
                <div className="md:col-span-4">
                  <div className="text-sm font-medium">{u.display_name || u.email}{self && <span className="ml-1.5 text-[10px] text-gold">(you)</span>}</div>
                  <div className="text-[11px] text-muted-foreground">{u.email}</div>
                </div>
                <div className="md:col-span-2 flex items-center">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs border",
                    u.role === "admin" ? "border-gold/40 bg-gold-soft text-gold" :
                    u.role === "owner" ? "border-blue-500/40 bg-blue-500/10 text-blue-400" :
                    "border-border bg-muted/40 text-muted-foreground",
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
                <div className="md:col-span-4 flex justify-end gap-1.5 flex-wrap">
                  <button title="Edit"
                    onClick={() => setEditing(u)}
                    className="inline-flex items-center gap-1 text-xs rounded-md border border-border bg-card px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                  <button title="Reset password" onClick={() => setResetting(u)}
                    className="inline-flex items-center gap-1 text-xs rounded-md border border-border bg-card px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
                    <KeyRound className="h-3 w-3" /> Password
                  </button>
                  <select
                    disabled={self || roleMut.isPending}
                    value={u.role}
                    onChange={(e) => roleMut.mutate({ id: u.id, role: e.target.value as AppRole })}
                    title={self ? "Can't change own role" : "Change role"}
                    className="text-xs rounded-md border border-gold/40 bg-gold-soft px-2 py-1.5 text-gold disabled:opacity-40"
                  >
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                    <option value="staff">Staff</option>
                  </select>
                  <button
                    disabled={self || activeMut.isPending}
                    onClick={() => activeMut.mutate({ id: u.id, active: !u.active })}
                    title={self ? "Can't change own status" : u.active ? "Deactivate" : "Activate"}
                    className="inline-flex items-center gap-1 text-xs rounded-md border border-border bg-card px-2.5 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  ><Power className="h-3 w-3" /> {u.active ? "Deactivate" : "Activate"}</button>
                  <button
                    disabled={self || delMut.isPending}
                    onClick={() => { if (confirm(`Delete ${u.display_name || u.email}? This cannot be undone.`)) delMut.mutate(u.id); }}
                    className="inline-flex items-center gap-1 text-xs rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-destructive disabled:opacity-30"
                  ><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onSubmit={async (vals: { email: string; password: string; display_name: string; role: AppRole }) => {
            try { await create({ data: vals }); toast.success("User created"); invalidate(); setShowCreate(false); }
            catch (e: any) { toast.error(e.message); }
          }}
        />
      )}
      {editing && (
        <EditUserModal user={editing} onClose={() => setEditing(null)}
          onSubmit={async (vals: { display_name: string; email: string }) => {
            try { await update({ data: { id: editing.id, ...vals } }); toast.success("User updated"); invalidate(); setEditing(null); }
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
      <div className="luxe-card rounded-xl p-5 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Field({ label, ...props }: any) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <input {...props} className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" />
    </label>
  );
}

function CreateUserModal({ onClose, onSubmit }: any) {
  const [v, setV] = useState({ email: "", password: "", display_name: "", role: "staff" as AppRole });
  return (
    <Modal title="Create User" onClose={onClose}>
      <Field label="Display Name" value={v.display_name} onChange={(e: any) => setV({ ...v, display_name: e.target.value })} />
      <Field label="Email" type="email" value={v.email} onChange={(e: any) => setV({ ...v, email: e.target.value })} />
      <Field label="Initial Password (min 8)" type="password" autoComplete="new-password" value={v.password} onChange={(e: any) => setV({ ...v, password: e.target.value })} />
      <label className="block space-y-1">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Role</span>
        <select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as AppRole })}
          className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm">
          <option value="staff">Staff</option>
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="text-xs rounded-md border border-border bg-card px-3 py-1.5">Cancel</button>
        <button onClick={() => onSubmit(v)} className="text-xs rounded-md gold-gradient px-3 py-1.5 font-medium text-charcoal">Create</button>
      </div>
    </Modal>
  );
}

function EditUserModal({ user, onClose, onSubmit }: any) {
  const [v, setV] = useState({ display_name: user.display_name ?? "", email: user.email ?? "" });
  return (
    <Modal title="Edit User" onClose={onClose}>
      <Field label="Display Name" value={v.display_name} onChange={(e: any) => setV({ ...v, display_name: e.target.value })} />
      <Field label="Email" type="email" value={v.email} onChange={(e: any) => setV({ ...v, email: e.target.value })} />
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="text-xs rounded-md border border-border bg-card px-3 py-1.5">Cancel</button>
        <button onClick={() => onSubmit(v)} className="text-xs rounded-md gold-gradient px-3 py-1.5 font-medium text-charcoal">Save</button>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onSubmit }: any) {
  const [pw, setPw] = useState("");
  return (
    <Modal title={`Reset password — ${user.display_name || user.email}`} onClose={onClose}>
      <Field label="New Password (min 8)" type="password" autoComplete="new-password" value={pw} onChange={(e: any) => setPw(e.target.value)} />
      <p className="text-[11px] text-muted-foreground">Share this password with the user securely. They can change it after sign-in.</p>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="text-xs rounded-md border border-border bg-card px-3 py-1.5">Cancel</button>
        <button onClick={() => onSubmit(pw)} disabled={pw.length < 8} className="text-xs rounded-md gold-gradient px-3 py-1.5 font-medium text-charcoal disabled:opacity-40">Reset</button>
      </div>
    </Modal>
  );
}
