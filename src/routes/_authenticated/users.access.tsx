import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { Topbar } from "@/components/topbar";
import { useUserRole } from "@/hooks/use-role";
import { Loader2, ShieldCheck, KeyRound, ArrowRight } from "lucide-react";

/**
 * Access Management — per-user permission overrides on top of role defaults.
 *
 * Phase 1 (this shipment): informational landing that explains how roles vs
 * overrides will work, and links to Role Management. Per-user overrides
 * require a new `user_permission_overrides` table and an updated
 * `my_permissions()` RPC. Tracked separately so we can ship the menu
 * hierarchy first and iterate on the override engine.
 */
export const Route = createFileRoute("/_authenticated/users/access")({
  component: AccessManagementPage,
});

function AccessManagementPage() {
  const { isAdmin, isLoading } = useUserRole();
  if (isLoading) return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  if (!isAdmin) return <Navigate to="/" />;

  return (
    <>
      <Topbar title="Access Management" subtitle="User-level permission overrides (in addition to role defaults)" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[900px] space-y-5">
        <div className="luxe-card rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-gold">
            <ShieldCheck className="h-4 w-4" />
            <h3 className="font-display text-base">How access works here</h3>
          </div>
          <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal pl-5">
            <li>Every user has a <span className="text-foreground">Role</span> (Owner, Admin, Reception, Staff…). Roles define the baseline permissions.</li>
            <li><span className="text-foreground">Role Management</span> sets which permissions each role gets — sidebar visibility, route access, module/action permissions.</li>
            <li><span className="text-foreground">Access Management</span> (this page) layers <em>per-user</em> overrides on top: grant a specific permission to one user who would not otherwise have it, or revoke a permission for a single user.</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Example: Reception role does not see Bookings List by default. You can override that for one user (e.g. <em>Pavan</em>) without changing the role.
          </p>
        </div>

        <div className="luxe-card rounded-xl p-5 space-y-3 border-warning/40 bg-warning/5">
          <div className="text-[11px] uppercase tracking-wider text-warning font-medium">Coming next</div>
          <p className="text-sm">
            Per-user overrides are scheduled for the next shipment. They require a small schema addition
            (<code className="text-[11px] px-1 py-0.5 rounded bg-muted/40">user_permission_overrides</code>) and an
            update to the permission resolver. Once shipped, you'll be able to pick a user here, see their effective
            permissions (role-inherited vs override), and grant / deny individual permissions with optional expiry.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link to="/users/management"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40">
            <KeyRound className="h-3.5 w-3.5" /> User Management <ArrowRight className="h-3 w-3" />
          </Link>
          <Link to="/users/roles"
            className="inline-flex items-center gap-1.5 rounded-md border border-gold/40 bg-gold-soft/30 px-3 py-2 text-xs hover:bg-gold-soft/50">
            <ShieldCheck className="h-3.5 w-3.5" /> Role Management <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </>
  );
}
