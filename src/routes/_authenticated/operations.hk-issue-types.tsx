/**
 * Operations → Masters → Housekeeping Issues.
 *
 * Each row surfaces in the Housekeeping task screen's "Issues" section.
 * Selecting an issue during task completion files a Complaint under the
 * associated category (or the seeded "Housekeeping Report" fallback).
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { useUserRole } from "@/hooks/use-role";
import { listHkIssueTypes, createHkIssueType, updateHkIssueType, deleteHkIssueType, type HkIssueTypeRow } from "@/lib/hk-issue-types-api";
import { listComplaintCategories } from "@/lib/complaints-api";
import { Plus, Pencil, Trash2, Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/operations/hk-issue-types")({
  component: HkIssueTypesPage,
});

function HkIssueTypesPage() {
  const { canManage, isLoading: roleLoading } = useUserRole();
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["hk-issue-types"], queryFn: () => listHkIssueTypes(false) });
  const { data: cats = [] } = useQuery({ queryKey: ["complaint-categories"], queryFn: () => listComplaintCategories(true) });
  const [editing, setEditing] = useState<HkIssueTypeRow | "new" | null>(null);

  const del = useMutation({
    mutationFn: (id: string) => deleteHkIssueType(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hk-issue-types"] }); toast.success("Deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  if (roleLoading) return <div className="p-16 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>;
  if (!canManage) return <Navigate to="/" />;

  const catName = (id: string | null): string => (cats as any[]).find((c) => c.id === id)?.name ?? "Housekeeping Report (fallback)";

  return (
    <>
      <Topbar title="Housekeeping Issues" subtitle="What housekeeping can flag during a task; each maps to a complaint category" />
      <div className="px-4 md:px-8 py-6 max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            The task screen always shows "No Issue" as the first option; that entry is not stored. Selecting any issue below files a Complaint under its mapped category.
          </p>
          <button onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1.5 rounded-md gold-gradient px-3 py-1.5 text-xs font-medium text-charcoal">
            <Plus className="h-3.5 w-3.5" /> New
          </button>
        </div>

        <div className="luxe-card rounded-xl overflow-hidden">
          {isLoading && <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>}
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-border/60 last:border-0 items-center">
              <div className="col-span-5 text-sm">{r.label}{!r.active && <span className="ml-2 text-[10px] text-muted-foreground">Inactive</span>}</div>
              <div className="col-span-4 text-xs text-muted-foreground">→ {catName(r.default_complaint_category_id)}</div>
              <div className="col-span-3 flex justify-end gap-1.5">
                <button onClick={() => setEditing(r)} className="inline-flex items-center gap-1 text-xs rounded-md border border-border px-2 py-1"><Pencil className="h-3 w-3" /> Edit</button>
                <button onClick={() => { if (confirm(`Delete ${r.label}?`)) del.mutate(r.id); }}
                  className="inline-flex items-center text-xs rounded-md border border-destructive/40 text-destructive px-2 py-1"><Trash2 className="h-3 w-3" /></button>
              </div>
            </div>
          ))}
          {!isLoading && rows.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">No issues configured yet.</div>}
        </div>
      </div>
      {editing && (
        <Editor row={editing === "new" ? null : editing} cats={cats as any[]}
          onClose={() => setEditing(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["hk-issue-types"] }); setEditing(null); }}
        />
      )}
    </>
  );
}

function Editor({ row, cats, onClose, onSaved }: {
  row: HkIssueTypeRow | null;
  cats: Array<{ id: string; name: string }>;
  onClose: () => void; onSaved: () => void;
}) {
  const [label, setLabel] = useState(row?.label ?? "");
  const [sort, setSort] = useState(String(row?.sort_order ?? 0));
  const [active, setActive] = useState(row?.active ?? true);
  const [cat, setCat] = useState<string>(row?.default_complaint_category_id ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const payload = { label: label.trim(), sort_order: Number(sort) || 0, active, default_complaint_category_id: cat || null };
      if (!payload.label) throw new Error("Label is required");
      if (row) await updateHkIssueType(row.id, payload);
      else await createHkIssueType(payload);
      toast.success("Saved");
      onSaved();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="luxe-card rounded-xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <h3 className="font-display text-lg">{row ? "Edit Issue" : "New Issue"}</h3>
          <button onClick={onClose}><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        <Field label="Label"><input className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. AC not cooling" /></Field>
        <Field label="Complaint Category (optional)">
          <select className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">— Housekeeping Report (fallback) —</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sort Order"><input className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" type="number" value={sort} onChange={(e) => setSort(e.target.value)} /></Field>
          <label className="flex items-end gap-2 text-xs pb-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active</label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-xs rounded-md border border-border px-3 py-1.5">Cancel</button>
          <button disabled={saving} onClick={save} className="inline-flex items-center gap-1.5 text-xs rounded-md gold-gradient px-3 py-1.5 font-medium text-charcoal disabled:opacity-50">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>{children}</label>;
}
