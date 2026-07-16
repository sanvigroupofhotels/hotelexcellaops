import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { updateCustomer, createCustomer, type CustomerRow } from "@/lib/customers-api";
import { LEAD_SOURCES, DEFAULT_TAGS } from "@/lib/mock-data";
import { useMasterData } from "@/hooks/use-master-data";
import { validatePhoneNumber } from "@/lib/phone";
import { CustomerPhonesPanel } from "@/components/customer-phones-panel";
import { cn } from "@/lib/utils";

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

const empty = {
  guest_name: "",
  phone: "",
  email: "",
  city: "",
  state: "",
  country: "India",
  company_name: "",
  gst_number: "",
  company_address: "",
  lead_source: "Direct",
  tags: [] as string[],
  internal_notes: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
};

export function CustomerEditDialog({
  open,
  onClose,
  customer,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  customer?: CustomerRow | null;
  onCreated?: (c: CustomerRow) => void;
}) {
  const qc = useQueryClient();
  const isCreate = !customer;
  const [form, setForm] = useState(empty);
  const { values: leadSources } = useMasterData("lead_source", [...LEAD_SOURCES]);
  const { values: tags } = useMasterData("tag", [...DEFAULT_TAGS]);

  useEffect(() => {
    if (!open) return;
    if (customer) {
      setForm({
        guest_name: customer.guest_name,
        phone: customer.phone ?? "",
        email: customer.email ?? "",
        city: customer.city ?? "",
        state: customer.state ?? "",
        country: customer.country ?? "India",
        company_name: customer.company_name ?? "",
        gst_number: customer.gst_number ?? "",
        company_address: customer.company_address ?? "",
        lead_source: customer.lead_source ?? "Direct",
        tags: customer.tags ?? [],
        internal_notes: customer.internal_notes ?? "",
        emergency_contact_name: (customer as any).emergency_contact_name ?? "",
        emergency_contact_phone: (customer as any).emergency_contact_phone ?? "",
      });
    } else {
      setForm(empty);
    }
  }, [open, customer]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.guest_name.trim()) throw new Error("Name is required");
      if (!form.phone.trim()) throw new Error("Mobile number is required");
      if (!validatePhoneNumber(form.phone)) throw new Error("Please enter a valid mobile number.");
      if (customer) return updateCustomer(customer.id, form as any);
      return createCustomer(form as any);
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      if (customer) qc.invalidateQueries({ queryKey: ["customer", customer.id] });
      toast.success(isCreate ? "Customer added" : "Customer updated");
      onCreated?.(row as CustomerRow);
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const set = (k: keyof typeof form, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const toggleTag = (t: string) =>
    set("tags", form.tags.includes(t) ? form.tags.filter((x) => x !== t) : [...form.tags, t]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-border bg-card/95 backdrop-blur">
          <h3 className="font-display text-xl">{isCreate ? "New Customer" : "Edit Customer"}</h3>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5 space-y-5">
          <Section title="Personal">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name" required>
                <input className={inputCls} value={form.guest_name} onChange={(e) => set("guest_name", e.target.value)} />
              </Field>
              <Field label="Phone" required>
                <input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label="Email">
                <input className={inputCls} value={form.email} onChange={(e) => set("email", e.target.value)} />
              </Field>
              <Field label="City">
                <input className={inputCls} value={form.city} onChange={(e) => set("city", e.target.value)} />
              </Field>
              <Field label="State">
                <input className={inputCls} value={form.state} onChange={(e) => set("state", e.target.value)} />
              </Field>
              <Field label="Country">
                <input className={inputCls} value={form.country} onChange={(e) => set("country", e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Company">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Company Name">
                <input className={inputCls} value={form.company_name} onChange={(e) => set("company_name", e.target.value)} />
              </Field>
              <Field label="GST Number">
                <input className={inputCls} value={form.gst_number} onChange={(e) => set("gst_number", e.target.value)} />
              </Field>
              <Field label="Company Address" full>
                <textarea rows={2} className={cn(inputCls, "resize-none")} value={form.company_address} onChange={(e) => set("company_address", e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Emergency Contact">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Contact Name">
                <input className={inputCls} value={form.emergency_contact_name} onChange={(e) => set("emergency_contact_name", e.target.value)} />
              </Field>
              <Field label="Contact Mobile">
                <input className={inputCls} value={form.emergency_contact_phone} onChange={(e) => set("emergency_contact_phone", e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Operations">
            <Field label="Internal Notes (never shared)" full>
              <textarea rows={3} className={cn(inputCls, "resize-none")} value={form.internal_notes} onChange={(e) => set("internal_notes", e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">Hidden from PDFs, WhatsApp, share images, and CSV exports.</p>
            </Field>
            <Field label="Tag" full>
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <button key={t} type="button" onClick={() => toggleTag(t)}
                    className={cn("px-3 py-1 rounded-full text-xs border transition",
                      form.tags.includes(t) ? "border-gold/50 bg-gold-soft text-gold" : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-gold/30")}>
                    {t}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Lead Source">
              <select className={inputCls} value={form.lead_source} onChange={(e) => set("lead_source", e.target.value)}>
                {leadSources.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </Section>
        </div>
        <div className="sticky bottom-0 px-5 py-4 border-t border-border bg-card/95 backdrop-blur flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border bg-card px-4 py-2 text-sm">Cancel</button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2 text-sm font-medium text-charcoal disabled:opacity-60"
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isCreate ? "Create Customer" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs uppercase tracking-wider text-gold mb-2">{title}</h4>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
function Field({ label, required, children, full }: any) {
  return (
    <label className={cn("block", full && "sm:col-span-2")}>
      <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
        {label}{required && <span className="text-gold ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
