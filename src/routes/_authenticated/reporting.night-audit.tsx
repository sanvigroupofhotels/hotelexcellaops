import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ShieldCheck, CheckCircle2 } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { PermissionGate } from "@/components/permission-gate";
import { listNightAuditRuns } from "@/lib/night-audit-api";

export const Route = createFileRoute("/_authenticated/reporting/night-audit")({
  component: () => <PermissionGate permission="reporting.night_audit.view"><NightAuditHistory /></PermissionGate>,
});

function NightAuditHistory() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["night-audit-history"],
    queryFn: () => listNightAuditRuns(200),
  });

  return (
    <>
      <Topbar title="Night Audit History" subtitle="Audit log of business date advancements" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] space-y-4">
        <div className="luxe-card rounded-xl p-4">
          {isLoading ? (
            <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-muted-foreground italic p-6 text-center">No night audit runs yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-2 px-2">Business Date</th>
                    <th className="text-left py-2 px-2">Advanced To</th>
                    <th className="text-left py-2 px-2">Run At</th>
                    <th className="text-left py-2 px-2">Triggered By</th>
                    <th className="text-left py-2 px-2">Mode</th>
                    <th className="text-right py-2 px-2">CI Resolved</th>
                    <th className="text-right py-2 px-2">CO Resolved</th>
                    <th className="text-left py-2 px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/40 hover:bg-secondary/20">
                      <td className="py-2 px-2 tabular-nums">{r.previous_business_date ?? "—"}</td>
                      <td className="py-2 px-2 tabular-nums">{r.new_business_date}</td>
                      <td className="py-2 px-2 tabular-nums text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("en-IN")}
                      </td>
                      <td className="py-2 px-2">{r.actor_name ?? "—"}</td>
                      <td className="py-2 px-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${
                          r.mode === "auto"
                            ? "border-blue-500/40 bg-blue-500/10 text-blue-500"
                            : "border-gold/40 bg-gold-soft/40 text-gold"
                        }`}>
                          {r.mode === "auto" ? "Scheduled" : "Manual"}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">{r.pending_check_ins_resolved}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{r.pending_check_outs_resolved}</td>
                      <td className="py-2 px-2">
                        <span className="inline-flex items-center gap-1 text-emerald-500 text-xs">
                          <CheckCircle2 className="h-3 w-3" /> Success
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-[10px] text-muted-foreground mt-3 flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" /> Showing the most recent 200 runs.
          </div>
        </div>
      </div>
    </>
  );
}
