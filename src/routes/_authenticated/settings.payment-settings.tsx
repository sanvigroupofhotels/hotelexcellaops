import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getPaymentSettings, setPaymentSettings, DEFAULT_PAYMENT_SETTINGS, type PaymentSettings } from "@/lib/app-settings-api";

export const Route = createFileRoute("/_authenticated/settings/payment-settings")({
  component: PaymentSettingsPage,
});

/**
 * Global Payment Settings. New bookings inherit these defaults; per-booking
 * values may override them in New Booking / Edit Booking. Moved out of
 * Master Data so payment configuration lives next to all other Settings.
 */
function PaymentSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["app-settings", "payment_settings"],
    queryFn: getPaymentSettings,
  });
  const [draft, setDraft] = useState<PaymentSettings>(DEFAULT_PAYMENT_SETTINGS);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (data) { setDraft(data); setDirty(false); } }, [data]);

  const save = useMutation({
    mutationFn: () => setPaymentSettings(draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings", "payment_settings"] });
      setDirty(false);
      toast.success("Payment settings saved");
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });
  const update = (patch: Partial<PaymentSettings>) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };

  if (isLoading) {
    return (
      <div className="luxe-card rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="luxe-card rounded-xl p-5 space-y-5">
      <div>
        <h3 className="font-display text-lg md:text-xl">Payment Settings</h3>
        <p className="text-xs text-muted-foreground">
          Default payment options applied to every new booking. Each booking can override these values
          from <span className="text-foreground">New Booking</span> and <span className="text-foreground">Edit Booking</span>.
        </p>
      </div>

      <div className="space-y-3">
        <ToggleRow label="Allow Full Payment" sub="Guest can pay the full balance via Razorpay"
          checked={draft.allow_full_payment} onChange={(v) => update({ allow_full_payment: v })} />
        <ToggleRow label="Allow Part Payment" sub="Guest can pay a partial advance via Razorpay"
          checked={draft.allow_part_payment} onChange={(v) => update({ allow_part_payment: v })} />
        <div className="flex items-center justify-between gap-3 py-1">
          <div>
            <div className="text-sm">Default Part Payment Percentage</div>
            <div className="text-[11px] text-muted-foreground">Pre-fills the part-payment amount in the Guest Portal.</div>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="text" inputMode="numeric" pattern="[0-9]*"
              value={draft.default_part_percent === 0 ? "" : String(draft.default_part_percent)}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9]/g, "");
                if (raw === "") { update({ default_part_percent: 0 }); return; }
                update({ default_part_percent: Math.min(100, Number(raw)) });
              }}
              className="w-16 bg-input/60 border border-border rounded-md px-2 py-1.5 text-sm text-right" />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>
        <ToggleRow label="Allow Pay At Hotel" sub="Guest can skip online payment and pay on arrival"
          checked={draft.allow_pay_at_hotel} onChange={(v) => update({ allow_pay_at_hotel: v })} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button onClick={() => save.mutate()} disabled={!dirty || save.isPending}
          className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-5 py-2 text-xs font-medium disabled:opacity-50">
          {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
        </button>
      </div>
    </div>
  );
}

function ToggleRow({ label, sub, checked, onChange }: { label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-3 cursor-pointer py-1">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 accent-gold shrink-0" />
    </label>
  );
}
