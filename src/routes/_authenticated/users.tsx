import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { useUserRole, type AppRole } from "@/hooks/use-role";
import { listUsers, setUserRole } from "@/lib/users-admin-api";
import { Loader2, ShieldCheck, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/users")({
  component: UsersPage,
});

function UsersPage() {
  const { isAdmin, isLoading: roleLoading } = useUserRole();
  const qc = useQueryClient();
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: listUsers,
    enabled: isAdmin,
  });
  const mut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: AppRole }) => setUserRole(id, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Role updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (roleLoading) {
    return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  }
  if (!isAdmin) return <Navigate to="/" />;

  return (
    <>
      <Topbar title="User Management" subtitle="Admin-only: assign roles to staff" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1100px] space-y-4">
        <p className="text-sm text-muted-foreground">
          Admins have full access. Staff see only Quotes, Customers, Tasks, Follow-ups & Calendar — no Dashboard, Analytics, Reports or User Management.
        </p>
        <div className="luxe-card rounded-xl overflow-hidden">
          <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border bg-secondary/30">
            <div className="col-span-5">User</div>
            <div className="col-span-3">Role</div>
            <div className="col-span-4 text-right">Change Role</div>
          </div>
          {isLoading && (
            <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          )}
          {users.map((u) => (
            <div key={u.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 px-4 md:px-6 py-4 border-b border-border/60 last:border-0">
              <div className="md:col-span-5">
                <div className="text-sm font-medium">{u.display_name || u.email}</div>
                <div className="text-[11px] text-muted-foreground">{u.email}</div>
              </div>
              <div className="md:col-span-3 flex items-center">
                <span className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs border",
                  u.role === "admin"
                    ? "border-gold/40 bg-gold-soft text-gold"
                    : "border-border bg-muted/40 text-muted-foreground",
                )}>
                  {u.role === "admin" ? <ShieldCheck className="h-3 w-3" /> : <UserIcon className="h-3 w-3" />}
                  {u.role === "admin" ? "Admin" : "Staff"}
                </span>
              </div>
              <div className="md:col-span-4 flex justify-end gap-2">
                <button
                  disabled={mut.isPending || u.role === "admin"}
                  onClick={() => mut.mutate({ id: u.id, role: "admin" })}
                  className="text-xs rounded-md border border-gold/40 bg-gold-soft px-3 py-1.5 text-gold hover:shadow-[0_0_12px_oklch(0.82_0.13_82/0.25)] disabled:opacity-40 disabled:cursor-not-allowed"
                >Promote to Admin</button>
                <button
                  disabled={mut.isPending || u.role === "staff"}
                  onClick={() => mut.mutate({ id: u.id, role: "staff" })}
                  className="text-xs rounded-md border border-border bg-card px-3 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                >Demote to Staff</button>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/80">
          Creating new users, password reset and deactivation will be added in the next phase (requires server-side admin API).
        </p>
      </div>
    </>
  );
}
