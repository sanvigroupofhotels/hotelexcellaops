/**
 * UAT-033 — Manage a customer's multiple mobile numbers.
 *
 * Renders a compact list panel: primary badge, add/edit/delete, promote to
 * primary. The Primary number is mirrored into customers.phone by a DB
 * trigger so legacy reads (WhatsApp, invoices, search-by-primary, CSV)
 * keep working. Any registered number resolves the same customer profile
 * through `findCustomerByAnyPhone`.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Star, Loader2, Phone as PhoneIcon } from "lucide-react";
import {
  listCustomerPhones, addCustomerPhone, deleteCustomerPhone, promoteCustomerPhone,
  updateCustomerPhone, type CustomerPhoneRow,
} from "@/lib/customer-phones-api";

export function CustomerPhonesPanel({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["customer-phones", customerId],
    queryFn: () => listCustomerPhones(customerId),
  });
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["customer-phones", customerId] });
    qc.invalidateQueries({ queryKey: ["customer", customerId] });
    qc.invalidateQueries({ queryKey: ["customers"] });
  };

  const addMut = useMutation({
    mutationFn: () => addCustomerPhone(customerId, phone, label || undefined, false),
    onSuccess: () => { setPhone(""); setLabel(""); toast.success("Phone added"); invalidate(); },
    onError: (e: any) => toast.error(e.message ?? "Could not add phone"),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => deleteCustomerPhone(id),
    onSuccess: () => { toast.success("Phone removed"); invalidate(); },
    onError: (e: any) => toast.error(e.message ?? "Could not remove"),
  });
  const promoteMut = useMutation({
    mutationFn: (id: string) => promoteCustomerPhone(id),
    onSuccess: () => { toast.success("Primary updated"); invalidate(); },
    onError: (e: any) => toast.error(e.message ?? "Could not update primary"),
  });
  const labelMut = useMutation({
    mutationFn: (v: { id: string; label: string | null }) => updateCustomerPhone(v.id, { label: v.label }),
    onSuccess: () => invalidate(),
  });

  const rows: CustomerPhoneRow[] = q.data ?? [];

  return (
    <div className="luxe-card rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <PhoneIcon className="h-4 w-4 text-gold" />
        <h3 className="font-display text-base">Mobile Numbers</h3>
      </div>
      {q.isLoading ? (
        <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-gold" /></div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">No phone numbers yet.</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-2 px-3 rounded-md bg-secondary/40 text-sm">
              <span className="font-mono">{r.phone}</span>
              <input
                defaultValue={r.label ?? ""}
                onBlur={(e) => e.target.value !== (r.label ?? "") && labelMut.mutate({ id: r.id, label: e.target.value || null })}
                placeholder="Label (Personal / Work)"
                className="flex-1 bg-transparent text-xs text-muted-foreground focus:outline-none focus:text-foreground"
              />
              {r.is_primary ? (
                <span className="inline-flex items-center gap-1 rounded-sm border border-gold/50 bg-gold-soft px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gold-dark">
                  <Star className="h-3 w-3" /> Primary
                </span>
              ) : (
                <button
                  onClick={() => promoteMut.mutate(r.id)}
                  className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-gold"
                  title="Make Primary"
                >
                  Set Primary
                </button>
              )}
              <button
                onClick={() => { if (confirm("Remove this phone number?")) delMut.mutate(r.id); }}
                className="p-1 text-muted-foreground hover:text-destructive"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border/40">
        <input
          value={phone} onChange={(e) => setPhone(e.target.value)}
          placeholder="+91 98xxxxxxxx"
          className="flex-1 bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
        />
        <input
          value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="sm:w-40 bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
        />
        <button
          onClick={() => phone.trim() && addMut.mutate()}
          disabled={!phone.trim() || addMut.isPending}
          className="inline-flex items-center gap-1.5 rounded-md gold-gradient px-3 py-2 text-xs font-medium text-charcoal disabled:opacity-50"
        >
          {addMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Duplicate numbers across different customers are blocked. Searching any registered number opens the same customer profile.
      </p>
    </div>
  );
}
