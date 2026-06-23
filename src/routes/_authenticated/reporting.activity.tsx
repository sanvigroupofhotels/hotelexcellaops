import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/use-role";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { downloadCsv } from "@/lib/csv";
import { Download, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reporting/activity")({
  component: ActivityTracking,
});

type Row = {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  page: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_reference: string | null;
  summary: string | null;
  source: string;
  before_state: any;
  after_state: any;
  metadata: any;
};

const SOURCES = ["all", "manual", "house_view", "guest_portal", "ota", "night_audit", "system", "api"];

function ActivityTracking() {
  const { isOwnerOrAdmin } = useUserRole();
  const [from, setFrom] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState<string>("all");
  const [action, setAction] = useState<string>("");
  const [page, setPage] = useState<string>("");
  const [actor, setActor] = useState<string>("");
  const [selected, setSelected] = useState<Row | null>(null);

  const { data = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["activity-log", { from, to, source, action, page, actor, isOwnerOrAdmin }],
    queryFn: async () => {
      let q = supabase
        .from("activity_log" as any)
        .select("*")
        .gte("occurred_at", `${from}T00:00:00`)
        .lte("occurred_at", `${to}T23:59:59`)
        .order("occurred_at", { ascending: false })
        .limit(500);
      if (source !== "all") q = q.eq("source", source);
      if (action.trim()) q = q.ilike("action", `%${action.trim()}%`);
      if (page.trim()) q = q.ilike("page", `%${page.trim()}%`);
      if (actor.trim() && isOwnerOrAdmin) q = q.ilike("actor_name", `%${actor.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const exportCsv = () => {
    const rows = data.map((r) => ({
      time: r.occurred_at,
      actor: r.actor_name ?? "",
      role: r.actor_role ?? "",
      page: r.page ?? "",
      action: r.action,
      entity_type: r.entity_type ?? "",
      entity_ref: r.entity_reference ?? "",
      source: r.source,
      summary: r.summary ?? "",
    }));
    downloadCsv("activity-log", rows);
  };

  return (
    <div className="space-y-4">
      <Topbar title="Activity Tracking" />
      <div className="px-4">
        <div className="luxe-card p-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div><label className="text-xs text-muted-foreground">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label className="text-xs text-muted-foreground">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div><label className="text-xs text-muted-foreground">Source</label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><label className="text-xs text-muted-foreground">Action</label>
              <Input placeholder="e.g. booking_moved" value={action} onChange={(e) => setAction(e.target.value)} /></div>
            <div><label className="text-xs text-muted-foreground">Page</label>
              <Input placeholder="e.g. House View" value={page} onChange={(e) => setPage(e.target.value)} /></div>
            {isOwnerOrAdmin && (
              <div><label className="text-xs text-muted-foreground">Actor</label>
                <Input placeholder="name" value={actor} onChange={(e) => setActor(e.target.value)} /></div>
            )}
          </div>
          <div className="flex gap-2 mt-3">
            <Button onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={!data.length}>
              <Download className="h-4 w-4 mr-2" />Export CSV
            </Button>
            {!isOwnerOrAdmin && (
              <span className="text-xs text-muted-foreground self-center ml-2">Showing your activity only</span>
            )}
          </div>
        </div>

        <div className="luxe-card mt-4 overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
          ) : !data.length ? (
            <div className="p-8 text-center text-muted-foreground">No activity in this range.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border/60">
                <tr>
                  <th className="text-left p-3">Time</th>
                  {isOwnerOrAdmin && <th className="text-left p-3">Actor</th>}
                  {isOwnerOrAdmin && <th className="text-left p-3">Role</th>}
                  <th className="text-left p-3">Page</th>
                  <th className="text-left p-3">Action</th>
                  <th className="text-left p-3">Entity</th>
                  <th className="text-left p-3">Source</th>
                  <th className="text-left p-3">Summary</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer"
                      onClick={() => setSelected(r)}>
                    <td className="p-3 whitespace-nowrap">{new Date(r.occurred_at).toLocaleString()}</td>
                    {isOwnerOrAdmin && <td className="p-3">{r.actor_name ?? "—"}</td>}
                    {isOwnerOrAdmin && <td className="p-3"><Badge variant="outline">{r.actor_role ?? "—"}</Badge></td>}
                    <td className="p-3">{r.page ?? "—"}</td>
                    <td className="p-3 font-mono text-xs">{r.action}</td>
                    <td className="p-3">{r.entity_reference ?? r.entity_type ?? "—"}</td>
                    <td className="p-3"><Badge variant="secondary">{r.source}</Badge></td>
                    <td className="p-3 text-muted-foreground">{r.summary ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader><SheetTitle>Activity detail</SheetTitle></SheetHeader>
          {selected && (
            <div className="space-y-4 mt-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Time</span><div>{new Date(selected.occurred_at).toLocaleString()}</div></div>
                <div><span className="text-muted-foreground">Action</span><div className="font-mono">{selected.action}</div></div>
                <div><span className="text-muted-foreground">Page</span><div>{selected.page ?? "—"}</div></div>
                <div><span className="text-muted-foreground">Source</span><div>{selected.source}</div></div>
                {isOwnerOrAdmin && <div><span className="text-muted-foreground">Actor</span><div>{selected.actor_name ?? "—"}</div></div>}
                {isOwnerOrAdmin && <div><span className="text-muted-foreground">Role</span><div>{selected.actor_role ?? "—"}</div></div>}
                <div className="col-span-2"><span className="text-muted-foreground">Entity</span>
                  <div>{selected.entity_type ?? "—"} · {selected.entity_reference ?? selected.entity_id ?? ""}</div></div>
                {selected.summary && <div className="col-span-2"><span className="text-muted-foreground">Summary</span><div>{selected.summary}</div></div>}
              </div>
              {selected.before_state && (
                <div>
                  <div className="text-xs uppercase text-muted-foreground mb-1">Before</div>
                  <pre className="text-xs bg-muted/50 rounded p-3 overflow-x-auto">{JSON.stringify(selected.before_state, null, 2)}</pre>
                </div>
              )}
              {selected.after_state && (
                <div>
                  <div className="text-xs uppercase text-muted-foreground mb-1">After</div>
                  <pre className="text-xs bg-muted/50 rounded p-3 overflow-x-auto">{JSON.stringify(selected.after_state, null, 2)}</pre>
                </div>
              )}
              {selected.metadata && (
                <div>
                  <div className="text-xs uppercase text-muted-foreground mb-1">Metadata</div>
                  <pre className="text-xs bg-muted/50 rounded p-3 overflow-x-auto">{JSON.stringify(selected.metadata, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
