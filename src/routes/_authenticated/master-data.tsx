import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { AdminOnly } from "@/components/admin-only";
import { listMasterData, createMasterData, updateMasterData, deleteMasterData, type MasterDataRow } from "@/lib/master-data-api";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/master-data")({ component: MasterDataPage });

const CATEGORIES = [
  { key: "lead_source", label: "Lead Sources" },
  { key: "tag", label: "Customer Tags" },
];

const inputCls = "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40";

function MasterDataPage() {
  return (
    <AdminOnly>
      <Topbar title="Master Data" subtitle="Manage lead sources, tags, and admin lookups" />
      <Content />
    </AdminOnly>
  );
}

function Content() {
  const [tab, setTab] = useState(CATEGORIES[0].key);
  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1100px] space-y-6">
      <div className="luxe-card rounded-xl p-3 flex flex-wrap gap-1">
        {CATEGORIES.map((c) => (
          <button key={c.key} onClick={() => setTab(c.key)}
            className={cn("px-3 py-1.5 rounded-md text-xs", tab === c.key ? "bg-gold-soft text-gold border border-gold/40" : "text-muted-foreground hover:text-foreground")}>
            {c.label}
          </button>
        ))}
      </div>
      <CategoryEditor category={tab} title={CATEGORIES.find((c) => c.key === tab)?.label ?? tab} />
    </div>
  );
}

function CategoryEditor({ category, title }: { category: string; title: string }) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["master-data", category], queryFn: () => listMasterData(category) });
  const [newLabel, setNewLabel] = useState("");

  const create = useMutation({
    mutationFn: () => createMasterData({
      category,
      value: newLabel.trim(),
      label: newLabel.trim(),
      sort_order: (rows.at(-1)?.sort_order ?? 0) + 10,
    }),
    onSuccess: () => { setNewLabel(""); qc.invalidateQueries({ queryKey: ["master-data", category] }); toast.success("Added"); },
    onError: (e: any) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<MasterDataRow> }) => updateMasterData(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["master-data", category] }),
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteMasterData(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["master-data", category] }); toast.success("Deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="luxe-card rounded-xl p-5 space-y-4">
      <h3 className="font-display text-xl">{title}</h3>

      <div className="flex gap-2">
        <input className={inputCls} placeholder="New entry (e.g. Agoda)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newLabel.trim()) create.mutate(); }} />
        <button onClick={() => create.mutate()} disabled={!newLabel.trim() || create.isPending} className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : (
        <div className="rounded-md border border-border divide-y divide-border">
          {rows.length === 0 && <div className="p-4 text-xs text-muted-foreground text-center">No entries yet.</div>}
          {rows.map((r) => (
            <div key={r.id} className="p-3 flex items-center gap-3">
              <input className="flex-1 bg-input/60 border border-border rounded-md px-2 py-1.5 text-sm" defaultValue={r.label}
                onBlur={(e) => { if (e.target.value !== r.label) update.mutate({ id: r.id, patch: { label: e.target.value } }); }} />
              <input type="number" className="w-20 bg-input/60 border border-border rounded-md px-2 py-1.5 text-xs" defaultValue={r.sort_order}
                onBlur={(e) => { const v = Number(e.target.value); if (v !== r.sort_order) update.mutate({ id: r.id, patch: { sort_order: v } }); }} title="Sort order" />
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input type="checkbox" className="h-4 w-4 accent-gold" checked={r.active} onChange={(e) => update.mutate({ id: r.id, patch: { active: e.target.checked } })} />
                Active
              </label>
              <button onClick={() => { if (confirm("Delete this entry?")) del.mutate(r.id); }} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
