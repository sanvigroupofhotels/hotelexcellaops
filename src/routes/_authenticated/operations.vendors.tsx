import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Phone, MapPin, MessageCircle, X, Loader2, Trash2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/hooks/use-role";
import { listVendors, createVendor, updateVendor, deleteVendor, type VendorRow, type VendorInput } from "@/lib/vendors-api";
import { phoneToWaDigits } from "@/lib/phone";

export const Route = createFileRoute("/_authenticated/operations/vendors")({ component: VendorsPage });

const inputCls = "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40";
const labelCls = "text-[11px] uppercase tracking-wider text-muted-foreground";

function VendorsPage() {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<VendorRow | null>(null);
  const [creating, setCreating] = useState(false);
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["vendors"], queryFn: () => listVendors() });

  const filtered = rows.filter((v) =>
    !search || v.name.toLowerCase().includes(search.toLowerCase()) ||
    v.contact_person.toLowerCase().includes(search.toLowerCase()) ||
    v.phone.includes(search),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendors…"
            className={cn(inputCls, "pl-9")} />
        </div>
        <button onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-3 py-2 text-xs font-medium whitespace-nowrap">
          <Plus className="h-3.5 w-3.5" /> Vendor
        </button>
      </div>

      {isLoading ? (
        <div className="luxe-card rounded-xl p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : filtered.length === 0 ? (
        <div className="luxe-card rounded-xl p-10 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? "No vendors yet. Add your first supplier." : "No matches."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filtered.map((v) => (
            <div key={v.id} className="luxe-card rounded-xl p-3.5">
              <button onClick={() => setEditing(v)} className="text-left w-full">
                <div className="text-sm font-medium flex items-center gap-1.5">
                  {v.name}
                  {!v.active && <span className="text-[10px] text-muted-foreground">(inactive)</span>}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{v.contact_person} · {v.phone}</div>
              </button>
              <div className="flex items-center gap-1.5 mt-2.5">
                <a href={`tel:${v.phone}`} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-gold/40 text-gold px-2 py-1.5 text-[11px]">
                  <Phone className="h-3 w-3" /> Call
                </a>
                <a href={`https://wa.me/${phoneToWaDigits(v.phone)}`} target="_blank" rel="noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-[11px]">
                  <MessageCircle className="h-3 w-3" /> WhatsApp
                </a>
                {v.maps_url && (
                  <a href={v.maps_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-md border border-border px-2 py-1.5 text-[11px]"
                    title="Open in Maps">
                    <MapPin className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <VendorDialog onClose={() => setCreating(false)} />}
      {editing && <VendorDialog vendor={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function VendorDialog({ vendor, onClose }: { vendor?: VendorRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { isAdmin, isOwner } = useUserRole();
  const canDelete = isAdmin || isOwner;

  const [name, setName] = useState(vendor?.name ?? "");
  const [contact, setContact] = useState(vendor?.contact_person ?? "");
  const [phone, setPhone] = useState(vendor?.phone ?? "");
  const [alt, setAlt] = useState<string[]>(vendor?.alt_phones ?? []);
  const [address, setAddress] = useState(vendor?.address ?? "");
  const [maps, setMaps] = useState(vendor?.maps_url ?? "");
  const [notes, setNotes] = useState(vendor?.notes ?? "");
  const [active, setActive] = useState(vendor?.active ?? true);

  const save = useMutation({
    mutationFn: async () => {
      const payload: VendorInput = {
        name, contact_person: contact, phone, alt_phones: alt.filter((x) => x.trim()),
        address: address || null, maps_url: maps || null, notes: notes || null, active,
      };
      if (vendor) await updateVendor(vendor.id, payload);
      else await createVendor(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success(vendor ? "Vendor saved" : "Vendor added");
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  const del = useMutation({
    mutationFn: () => deleteVendor(vendor!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success("Vendor deleted"); onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Delete failed"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full md:max-w-lg max-h-[92vh] flex flex-col bg-card border border-border rounded-t-2xl md:rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-display text-base md:text-lg">{vendor ? "Edit Vendor" : "New Vendor"}</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 overflow-y-auto grid gap-3">
          <Field label="Vendor Name *"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Contact Person *"><input className={inputCls} value={contact} onChange={(e) => setContact(e.target.value)} /></Field>
          <Field label="Mobile Number *">
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" inputMode="tel" />
          </Field>
          <Field label="Alternate Mobile Numbers">
            <div className="space-y-2">
              {alt.map((p, idx) => (
                <div key={idx} className="flex gap-2">
                  <input className={inputCls} value={p}
                    onChange={(e) => { const next = [...alt]; next[idx] = e.target.value; setAlt(next); }} />
                  <button onClick={() => setAlt(alt.filter((_, i) => i !== idx))}
                    className="px-2 text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
                </div>
              ))}
              <button onClick={() => setAlt([...alt, ""])}
                className="text-[11px] text-gold hover:underline">+ Add another number</button>
            </div>
          </Field>
          <Field label="Physical Address">
            <textarea className={cn(inputCls, "min-h-[60px]")} value={address ?? ""} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label="Google Maps Link">
            <input className={inputCls} value={maps ?? ""} onChange={(e) => setMaps(e.target.value)} placeholder="https://maps.google.com/…" />
          </Field>
          <Field label="Notes">
            <textarea className={cn(inputCls, "min-h-[60px]")} value={notes ?? ""} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
          </label>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center gap-2 flex-wrap">
          {vendor && canDelete && (
            <button onClick={() => { if (confirm("Delete this vendor?")) del.mutate(); }} disabled={del.isPending}
              className="inline-flex items-center gap-1.5 border border-destructive/40 text-destructive rounded-md px-3 py-2 text-xs">
              {del.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-2 text-xs">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || !name.trim() || !contact.trim() || !phone.trim()}
            className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-4 py-2 text-xs font-medium disabled:opacity-60">
            {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><div className={labelCls}>{label}</div>{children}</div>;
}
