import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { AdminOnly } from "@/components/admin-only";
import { listMasterData, createMasterData, updateMasterData, deleteMasterData, type MasterDataRow } from "@/lib/master-data-api";
import { Plus, Trash2, Loader2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/master-data")({ component: MasterDataPage });

/**
 * Master Data hub — single source of truth for dropdowns across the app.
 * Grouped by domain. Each sub-tab edits one category.
 *
 * The hub also surfaces deep-links to existing dedicated masters that already have
 * full CRUD (Rooms, Staff, Expense Types) so users have a single entry point.
 */
type CategoryDef = { key: string; label: string; placeholder?: string };
type GroupDef = { label: string; categories: CategoryDef[]; deepLinks?: { label: string; to: string }[] };

const GROUPS: GroupDef[] = [
  {
    label: "Customers",
    categories: [
      { key: "lead_source", label: "Lead Sources", placeholder: "e.g. Agoda" },
      { key: "tag", label: "Customer Tags", placeholder: "e.g. VIP" },
    ],
  },
  {
    label: "Bookings / Quotes",
    categories: [
      { key: "payment_method", label: "Payment Methods", placeholder: "e.g. Wallet" },
    ],
  },
  {
    label: "Rooms",
    categories: [],
    deepLinks: [
      { label: "Manage Rooms & Inventory", to: "/rooms" },
      { label: "Rates & Inventory Calendar", to: "/rates" },
    ],
  },
  {
    label: "CashBook",
    categories: [
      { key: "income_category", label: "Income Categories", placeholder: "e.g. Donation" },
    ],
    deepLinks: [
      { label: "Manage Expense Types", to: "/cash" },
      { label: "Manage Staff", to: "/cash" },
    ],
  },
  {
    label: "Complaints",
    categories: [
      { key: "complaint_status", label: "Complaint Statuses", placeholder: "e.g. Pending Vendor" },
    ],
  },
];

const inputCls = "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40";

function MasterDataPage() {
  return (
    <AdminOnly>
      <Topbar title="Master Data" subtitle="Single source of truth for dropdowns across the app" />
      <Content />
    </AdminOnly>
  );
}

function Content() {
  const [activeGroup, setActiveGroup] = useState(GROUPS[0].label);
  const group = GROUPS.find((g) => g.label === activeGroup)!;
  const [activeCat, setActiveCat] = useState<string | null>(group.categories[0]?.key ?? null);

  return (
    <div className="px-4 md:px-6 py-5 md:py-8 max-w-[1100px] space-y-5">
      {/* Group nav — horizontally scrollable on mobile */}
      <div className="luxe-card rounded-xl p-2 flex gap-1 overflow-x-auto">
        {GROUPS.map((g) => (
          <button key={g.label} onClick={() => { setActiveGroup(g.label); setActiveCat(g.categories[0]?.key ?? null); }}
            className={cn("shrink-0 px-3 py-2 rounded-md text-xs whitespace-nowrap",
              g.label === activeGroup ? "bg-gold-soft text-gold border border-gold/40" : "text-muted-foreground hover:text-foreground")}>
            {g.label}
          </button>
        ))}
      </div>

      {/* Category sub-nav inside the active group */}
      {group.categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {group.categories.map((c) => (
            <button key={c.key} onClick={() => setActiveCat(c.key)}
              className={cn("px-3 py-1.5 rounded-md text-[11px] border",
                c.key === activeCat ? "bg-gold-soft border-gold/40 text-gold" : "border-border text-muted-foreground hover:text-foreground")}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {activeCat && (
        <CategoryEditor
          category={activeCat}
          title={group.categories.find((c) => c.key === activeCat)?.label ?? activeCat}
          placeholder={group.categories.find((c) => c.key === activeCat)?.placeholder}
        />
      )}

      {/* Deep-links to dedicated CRUD pages */}
      {group.deepLinks && group.deepLinks.length > 0 && (
        <div className="luxe-card rounded-xl p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Linked Masters</div>
          {group.deepLinks.map((l) => (
            <Link key={l.to + l.label} to={l.to} className="flex items-center justify-between rounded-md bg-secondary/30 hover:bg-secondary/60 transition px-3 py-2 text-sm">
              <span>{l.label}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryEditor({ category, title, placeholder }: { category: string; title: string; placeholder?: string }) {
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
    <div className="luxe-card rounded-xl p-4 md:p-5 space-y-4">
      <h3 className="font-display text-lg md:text-xl">{title}</h3>

      <div className="flex flex-col sm:flex-row gap-2">
        <input className={inputCls} placeholder={placeholder ?? "New entry"} value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newLabel.trim()) create.mutate(); }} />
        <button onClick={() => create.mutate()} disabled={!newLabel.trim() || create.isPending}
          className="shrink-0 inline-flex items-center justify-center gap-1.5 gold-gradient text-charcoal rounded-md px-4 py-2 text-xs font-medium disabled:opacity-60">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : (
        <div className="rounded-md border border-border divide-y divide-border">
          {rows.length === 0 && <div className="p-4 text-xs text-muted-foreground text-center">No entries yet.</div>}
          {rows.map((r) => (
            <div key={r.id} className="p-2.5 flex flex-wrap items-center gap-2">
              <input className="flex-1 min-w-[180px] bg-input/60 border border-border rounded-md px-2 py-1.5 text-sm" defaultValue={r.label}
                onBlur={(e) => { if (e.target.value !== r.label) update.mutate({ id: r.id, patch: { label: e.target.value } }); }} />
              <input type="number" className="w-16 bg-input/60 border border-border rounded-md px-2 py-1.5 text-xs" defaultValue={r.sort_order}
                onBlur={(e) => { const v = Number(e.target.value); if (v !== r.sort_order) update.mutate({ id: r.id, patch: { sort_order: v } }); }} title="Sort order" />
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input type="checkbox" className="h-4 w-4 accent-gold" checked={r.active} onChange={(e) => update.mutate({ id: r.id, patch: { active: e.target.checked } })} />
                Active
              </label>
              <button onClick={() => { if (confirm("Delete this entry?")) del.mutate(r.id); }}
                className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
