/**
 * Operations → Masters → Linen Types.
 *
 * Admin/owner-only. Each linen type is a row with a canonical name and a
 * default quantity used by every housekeeping task's linen block. Housekeeping
 * staff cannot edit these values from the task screen (design §5.3).
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { useUserRole } from "@/hooks/use-role";
import { listLinenTypes, createLinenType, updateLinenType, deleteLinenType, type LinenTypeRow } from "@/lib/linen-master-api";
import { Plus, Pencil, Trash2, Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/operations/linen-types")({
  component: LinenTypesPage,
});

function LinenTypesPage() {
  const { canManage, isLoading: roleLoading } = useUserRole();
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["linen-types"], queryFn: () => listLinenTypes(false) });
  const [editing, setEditing] = useState<LinenTypeRow | "new" | null>(null);

  const del = useMutation({
    mutationFn: (id: string) => deleteLinenType(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["linen-types"] }); toast.success("Deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  if (roleLoading) return <div className="p-16 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>;
  if (!canManage) return <Navigate to="/" />;

  return (
    <>
      <Topbar title="Linen Types" subtitle="Master list used by the Housekeeping linen block and the Laundry queue" />
      <div className="px-4 md:px-8 py-6 max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Housekeeping picks these on every task. Editing here doesn't rewrite historical queue rows — each task snapshots the name and quantity at submit time.
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
              <div className="col-span-6 text-sm">{r.name}{!r.active && <span className="ml-2 text-[10px] text-muted-foreground">Inactive</span>}</div>
              <div className="col-span-3 text-xs text-muted-foreground">qty {r.default_qty}</div>
              <div className="col-span-3 flex justify-end gap-1.5">
                <button onClick={() => setEditing(r)}
                  className="inline-flex items-center gap-1 text-xs rounded-md border border-border px-2 py-1"><Pencil className="h-3 w-3" /> Edit</button>
                <button onClick={() => { if (confirm(`Delete ${r.name}?`)) del.mutate(r.id); }}
                  className="inline-flex items-center text-xs rounded-md border border-destructive/40 text-destructive px-2 py-1"><Trash2 className="h-3 w-3" /></button>
              </div>
            </div>
          ))}
          {!isLoading && rows.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">No linen types yet.</div>}
        </div>
      </div>
      {editing && (
        <Editor row={editing === "new" ? null : editing} onClose={() => setEditing(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["linen-types"] }); setEditing(null); }}
        />
      )}
    </>
  );
}

function Editor({ row, onClose, onSaved }: { row: LinenTypeRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(row?.name ?? "");
  const [qty, setQty] = useState(String(row?.default_qty ?? 1));
  const [sort, setSort] = useState(String(row?.sort_order ?? 0));
  const [active, setActive] = useState(row?.active ?? true);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const payload = { name: name.trim(), default_qty: Math.max(1, Math.floor(Number(qty) || 1)), sort_order: Number(sort) || 0, active };
      if (!payload.name) throw new Error("Name is required");
      if (row) await updateLinenType(row.id, payload);
      else await createLinenType(payload);
      toast.success("Saved");
      onSaved();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="luxe-card rounded-xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <h3 className="font-display text-lg">{row ? "Edit Linen Type" : "New Linen Type"}</h3>
          <button onClick={onClose}><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        <Field label="Name"><input className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bedsheet" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default Qty"><input className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label="Sort Order"><input className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm" type="number" value={sort} onChange={(e) => setSort(e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active</label>
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
