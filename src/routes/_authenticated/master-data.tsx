import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { AdminOnly } from "@/components/admin-only";
import { listMasterData, createMasterData, updateMasterData, deleteMasterData, type MasterDataRow } from "@/lib/master-data-api";
import { getPaymentSettings, setPaymentSettings, DEFAULT_PAYMENT_SETTINGS, type PaymentSettings } from "@/lib/app-settings-api";
import { listStaff, createStaff, updateStaff, listExpenseTypes, createExpenseType, updateExpenseType } from "@/lib/cash-api";
import { listComplaintCategories, createComplaintCategory, updateComplaintCategory } from "@/lib/complaints-api";
import { Plus, Trash2, Loader2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/master-data")({ component: MasterDataPage });

/**
 * Master Data hub — single source of truth for dropdowns across the app.
 * Grouped by domain. Each sub-tab edits one category.
 *
 * Two editor flavours:
 * - CategoryEditor → generic `master_data` rows (value/label/sort_order/active)
 * - NameMasterEditor → dedicated tables with `{name, active}` (Staff, Expense Types, Complaint Categories)
 *
 * The hub also surfaces deep-links to existing dedicated masters that already have
 * full CRUD (Rooms, Rates) so users have a single entry point.
 */
type LookupDef = { kind: "lookup"; key: string; label: string; placeholder?: string };
type NameMasterKey = "staff" | "expense_types" | "complaint_categories";
type NameDef = { kind: "name"; key: NameMasterKey; label: string; placeholder?: string };
type SettingsKey = "payment_settings";
type SettingsDef = { kind: "settings"; key: SettingsKey; label: string };
type CategoryDef = LookupDef | NameDef | SettingsDef;
type GroupDef = { label: string; categories: CategoryDef[]; deepLinks?: { label: string; to: string }[] };

const GROUPS: GroupDef[] = [
  {
    label: "Customers",
    categories: [
      { kind: "lookup", key: "lead_source", label: "Lead Sources", placeholder: "e.g. Agoda" },
      { kind: "lookup", key: "tag", label: "Customer Tags", placeholder: "e.g. VIP" },
    ],
  },
  {
    label: "Bookings / Quotes",
    categories: [
      { kind: "lookup", key: "payment_method", label: "Payment Methods", placeholder: "e.g. Wallet" },
    ],
  },
  {
    label: "Booking Settings",
    categories: [
      { kind: "settings", key: "payment_settings", label: "Payment Settings" },
    ],
  },
  {
    label: "Rooms & Rates",
    categories: [],
    deepLinks: [
      { label: "Manage Rooms & Inventory", to: "/rooms" },
      { label: "Rates & Inventory Calendar", to: "/rates" },
    ],
  },
  {
    label: "CashBook",
    categories: [
      { kind: "name", key: "staff", label: "Staff", placeholder: "e.g. Ravi Kumar" },
      { kind: "name", key: "expense_types", label: "Expense Types", placeholder: "e.g. Laundry" },
      { kind: "lookup", key: "income_category", label: "Income Categories", placeholder: "e.g. Donation" },
    ],
  },
  {
    label: "Complaints",
    categories: [
      { kind: "name", key: "complaint_categories", label: "Complaint Categories", placeholder: "e.g. Plumbing" },
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

  const cat = group.categories.find((c) => c.key === activeCat);

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

      {cat && cat.kind === "lookup" && (
        <CategoryEditor category={cat.key} title={cat.label} placeholder={cat.placeholder} />
      )}
      {cat && cat.kind === "name" && (
        <NameMasterEditor masterKey={cat.key} title={cat.label} placeholder={cat.placeholder} />
      )}
      {cat && cat.kind === "settings" && cat.key === "payment_settings" && (
        <PaymentSettingsEditor />
      )}

      {/* Deep-links to dedicated CRUD pages */}
      {group.deepLinks && group.deepLinks.length > 0 && (
        <div className="luxe-card rounded-xl p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Linked Masters</div>
          {group.deepLinks.map((l) => (
            <Link key={l.to + l.label} to={l.to as any} className="flex items-center justify-between rounded-md bg-secondary/30 hover:bg-secondary/60 transition px-3 py-2 text-sm">
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

/**
 * Inline CRUD editor for `{ name, active }`-shaped tables (Staff, Expense Types,
 * Complaint Categories). Deactivation is non-destructive — existing references
 * keep working, the entry just disappears from new-dropdown options.
 */
function NameMasterEditor({ masterKey, title, placeholder }: { masterKey: NameMasterKey; title: string; placeholder?: string }) {
  const qc = useQueryClient();
  const queryKey = ["name-master", masterKey];

  const list = async () => {
    if (masterKey === "staff") return (await listStaff(false)).map((r) => ({ id: r.id, name: r.name, active: r.active, mobile: (r as any).mobile ?? null }));
    if (masterKey === "expense_types") return (await listExpenseTypes(false)).map((r) => ({ id: r.id, name: r.name, active: r.active, mobile: null }));
    return (await listComplaintCategories(false)).map((r) => ({ id: r.id, name: r.name, active: r.active, mobile: null }));
  };
  const create = async (name: string, mobile?: string) => {
    if (masterKey === "staff") return createStaff(name, mobile);
    if (masterKey === "expense_types") return createExpenseType(name);
    return createComplaintCategory(name);
  };
  const update = async (id: string, patch: { name?: string; active?: boolean; mobile?: string | null }) => {
    if (masterKey === "staff") return updateStaff(id, patch as any);
    if (masterKey === "expense_types") return updateExpenseType(id, { name: patch.name, active: patch.active });
    return updateComplaintCategory(id, { name: patch.name, active: patch.active });
  };

  const { data: rows = [], isLoading } = useQuery({ queryKey, queryFn: list });
  const [newName, setNewName] = useState("");
  const [newMobile, setNewMobile] = useState("");

  const createMut = useMutation({
    mutationFn: () => create(newName.trim(), masterKey === "staff" && newMobile.trim() ? newMobile.trim() : undefined),
    onSuccess: () => { setNewName(""); setNewMobile(""); qc.invalidateQueries({ queryKey }); toast.success("Added"); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; active?: boolean; mobile?: string | null } }) => update(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="luxe-card rounded-xl p-4 md:p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="font-display text-lg md:text-xl">{title}</h3>
        <span className="text-[10px] text-muted-foreground">Deactivation hides from new dropdowns; existing records are preserved.</span>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input className={inputCls} placeholder={placeholder ?? "New entry"} value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) createMut.mutate(); }} />
        {masterKey === "staff" && (
          <input className={cn(inputCls, "sm:w-44")} placeholder="Mobile (optional)" value={newMobile}
            onChange={(e) => setNewMobile(e.target.value)} />
        )}
        <button onClick={() => createMut.mutate()} disabled={!newName.trim() || createMut.isPending}
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
              <input className="flex-1 min-w-[180px] bg-input/60 border border-border rounded-md px-2 py-1.5 text-sm" defaultValue={r.name}
                onBlur={(e) => { if (e.target.value !== r.name && e.target.value.trim()) updateMut.mutate({ id: r.id, patch: { name: e.target.value.trim() } }); }} />
              {masterKey === "staff" && (
                <input className="w-36 bg-input/60 border border-border rounded-md px-2 py-1.5 text-xs" defaultValue={r.mobile ?? ""} placeholder="Mobile"
                  onBlur={(e) => { const v = e.target.value.trim(); if ((r.mobile ?? "") !== v) updateMut.mutate({ id: r.id, patch: { mobile: v || null } }); }} />
              )}
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input type="checkbox" className="h-4 w-4 accent-gold" checked={r.active}
                  onChange={(e) => updateMut.mutate({ id: r.id, patch: { active: e.target.checked } })} />
                Active
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentSettingsEditor() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["app-settings", "payment_settings"],
    queryFn: getPaymentSettings,
  });
  const [draft, setDraft] = useState<PaymentSettings>(DEFAULT_PAYMENT_SETTINGS);
  const [dirty, setDirty] = useState(false);
  // Sync local draft when query resolves
  useState(() => { /* noop init */ });
  if (data && !dirty && draft !== data) {
    // hydrate once
    setTimeout(() => setDraft(data), 0);
  }
  const saveMut = useMutation({
    mutationFn: () => setPaymentSettings(draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings", "payment_settings"] });
      setDirty(false);
      toast.success("Payment settings saved");
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });
  const update = (patch: Partial<PaymentSettings>) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };

  if (isLoading) return <div className="luxe-card rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  return (
    <div className="luxe-card rounded-xl p-5 space-y-4">
      <div>
        <h4 className="font-display text-lg">Payment Settings</h4>
        <p className="text-xs text-muted-foreground">Default payment options applied to every new booking. Can be overridden per booking.</p>
      </div>
      <div className="space-y-3">
        <ToggleRow label="Allow Full Payment" checked={draft.allow_full_payment} onChange={(v) => update({ allow_full_payment: v })} />
        <ToggleRow label="Allow Part Payment" checked={draft.allow_part_payment} onChange={(v) => update({ allow_part_payment: v })} />
        <div className="flex items-center justify-between gap-3 py-1">
          <div>
            <div className="text-sm">Default Part Payment Percentage</div>
            <div className="text-[11px] text-muted-foreground">Used when guest opens the payment link.</div>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number" min={1} max={100}
              value={draft.default_part_percent}
              onChange={(e) => update({ default_part_percent: Math.max(1, Math.min(100, Number(e.target.value) || 0)) })}
              className="w-20 bg-input/60 border border-border rounded-md px-2 py-1.5 text-sm text-right"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </div>
        <ToggleRow label="Allow Pay At Hotel" checked={draft.allow_pay_at_hotel} onChange={(v) => update({ allow_pay_at_hotel: v })} />
      </div>
      <div className="flex justify-end">
        <button onClick={() => saveMut.mutate()} disabled={!dirty || saveMut.isPending}
          className="gold-gradient text-charcoal text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50 inline-flex items-center gap-2">
          {saveMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save Settings
        </button>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 cursor-pointer">
      <span className="text-sm">{label}</span>
      <input type="checkbox" className="h-4 w-4 accent-gold" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
