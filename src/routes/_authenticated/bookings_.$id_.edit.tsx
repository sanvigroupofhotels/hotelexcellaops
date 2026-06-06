import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { getBooking, updateBooking } from "@/lib/bookings-api";
import { listBookingItems, replaceBookingItems, rowToLineItem } from "@/lib/booking-items-api";
import { LineItemsEditor, lineItemsTotal, type LineItem } from "@/components/line-items-editor";
import { BOOKING_STATUSES } from "@/lib/mock-data";
import { NumField } from "@/components/num-field";
import { ArrowLeft, Loader2, BedDouble, User, Phone, Mail, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/bookings_/$id_/edit")({
  component: EditBooking,
});

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

function EditBooking() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: b, isLoading } = useQuery({ queryKey: ["booking", id], queryFn: () => getBooking(id) });
  const { data: existingItems = [] } = useQuery({
    queryKey: ["booking-items", id], queryFn: () => listBookingItems(id), enabled: !!b,
  });

  const [form, setForm] = useState<any>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  useEffect(() => { if (b && !form) setForm({ ...b }); }, [b, form]);
  useEffect(() => { if (existingItems.length > 0 && items.length === 0) setItems(existingItems.map(rowToLineItem)); }, [existingItems, items.length]);

  const itemsTotal = useMemo(() => lineItemsTotal(items), [items]);
  useEffect(() => {
    if (items.length > 0) setForm((f: any) => f ? { ...f, amount: itemsTotal } : f);
  }, [itemsTotal, items.length]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      await updateBooking(id, {
        guest_name: form.guest_name, phone: form.phone, email: form.email,
        check_in: form.check_in, check_out: form.check_out,
        adults: form.adults, children: form.children, guests: form.guests,
        room_details: form.room_details, amount: form.amount, advance_paid: form.advance_paid,
        notes: form.notes, internal_notes: form.internal_notes,
        status: form.status, payment_status: form.payment_status, customer_id: form.customer_id,
      });
      if (items.length > 0) await replaceBookingItems(id, items);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["booking", id] });
      qc.invalidateQueries({ queryKey: ["booking-items", id] });
      toast.success("Booking updated");
      navigate({ to: "/bookings/$id", params: { id } });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !form) return <div className="p-20 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;

  const update = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const balance = Math.max(0, Number(form.amount) - Number(form.advance_paid ?? 0));

  return (
    <>
      <Topbar title="Edit Booking" subtitle={b!.booking_reference} />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] pb-32 lg:pb-8">
        <Link to="/bookings/$id" params={{ id }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to booking
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-6">
            <section className="luxe-card rounded-xl p-5 md:p-6 space-y-4">
              <h4 className="font-display text-lg">Guest Details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Guest Name" icon={User} required>
                  <input className={inputCls} value={form.guest_name ?? ""} onChange={(e) => update("guest_name", e.target.value)} />
                </Field>
                <Field label="Phone" icon={Phone}>
                  <input className={inputCls} value={form.phone ?? ""} onChange={(e) => update("phone", e.target.value)} />
                </Field>
                <Field label="Email" icon={Mail}>
                  <input className={inputCls} value={form.email ?? ""} onChange={(e) => update("email", e.target.value)} />
                </Field>
                <Field label="Status">
                  <select className={inputCls} value={form.status} onChange={(e) => update("status", e.target.value)}>
                    {BOOKING_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <NumField label="Guests" value={form.guests} min={1} onChange={(v) => update("guests", v)} />
                <NumField label="Adults" value={form.adults} min={1} onChange={(v) => update("adults", v)} />
                <NumField label="Children" value={form.children} min={0} onChange={(v) => update("children", v)} />
              </div>
            </section>

            <section className="luxe-card rounded-xl p-5 md:p-6 space-y-4">
              <h4 className="font-display text-lg flex items-center gap-2"><BedDouble className="h-4 w-4 text-gold" /> Stay Items</h4>
              <LineItemsEditor items={items} onChange={setItems} title="Rooms / Split Stay"
                hint="Edit rooms and stays. Amount auto-syncs with items total." startIndex={1} />
              <div className="flex items-baseline justify-between border-t border-border pt-3 text-sm">
                <span className="text-muted-foreground">Items Total</span>
                <span className="font-display text-xl gold-text-gradient">₹{itemsTotal.toLocaleString("en-IN")}</span>
              </div>
            </section>

            <section className="luxe-card rounded-xl p-5 md:p-6 space-y-4">
              <h4 className="font-display text-lg">Payment</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <NumField label="Total Amount (₹)" value={form.amount} min={0} onChange={(v) => update("amount", v)} prefix="₹" />
                <NumField label="Advance Paid (₹)" value={form.advance_paid ?? 0} min={0} onChange={(v) => update("advance_paid", v)} prefix="₹" />
                <div className="rounded-md bg-secondary/40 border border-border px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Balance Payable</div>
                  <div className="font-display text-lg gold-text-gradient">₹{balance.toLocaleString("en-IN")}</div>
                </div>
              </div>
              <Field label="Room Details (summary)">
                <input className={inputCls} value={form.room_details ?? ""} onChange={(e) => update("room_details", e.target.value)} />
              </Field>
              <Field label="Special Requests (visible to guest)">
                <textarea rows={2} className={cn(inputCls, "resize-none")} value={form.notes ?? ""} onChange={(e) => update("notes", e.target.value)} placeholder="Any specific guest requests…" />
              </Field>
              <Field label="Internal Notes (never shared)">
                <textarea rows={2} className={cn(inputCls, "resize-none")} value={form.internal_notes ?? ""} onChange={(e) => update("internal_notes", e.target.value)} />
              </Field>
            </section>
          </div>

          <div className="hidden lg:block lg:sticky lg:top-24 self-start space-y-4">
            <div className="luxe-card rounded-xl p-5">
              <h4 className="font-display text-lg mb-3">Summary</h4>
              <Row label="Items Total" value={itemsTotal} />
              <Row label="Advance Paid" value={-Number(form.advance_paid ?? 0)} mute={!form.advance_paid} />
              <div className="luxe-divider my-3" />
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Balance</span>
                <span className="font-display text-2xl gold-text-gradient">₹{balance.toLocaleString("en-IN")}</span>
              </div>
            </div>
            <button onClick={() => save.mutate()} disabled={save.isPending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-3 text-sm font-medium text-charcoal disabled:opacity-60">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Changes
            </button>
          </div>
        </div>

        <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur p-3">
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-2.5 text-sm font-medium text-charcoal disabled:opacity-60">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Changes
          </button>
        </div>
      </div>
    </>
  );
}

function Field({ label, icon: Icon, required, children }: any) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
        {Icon && <Icon className="h-3 w-3" />}
        {label}{required && <span className="text-gold ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

function Row({ label, value, mute }: { label: string; value: number; mute?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between py-1.5 text-sm", mute && "text-muted-foreground/60")}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", value < 0 && "text-success")}>
        {value === 0 ? "—" : `${value < 0 ? "-" : ""}₹${Math.abs(value).toLocaleString("en-IN")}`}
      </span>
    </div>
  );
}
