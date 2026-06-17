import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getOpsSettings, setOpsSettings, type OpsSettings } from "@/lib/app-settings-api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/operations")({ component: OpsPage });

const inputCls = "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40";
const labelCls = "text-[11px] uppercase tracking-wider text-muted-foreground";

function OpsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["ops-settings"], queryFn: getOpsSettings });
  const [draft, setDraft] = useState<OpsSettings | null>(null);
  useEffect(() => { if (data) setDraft(data); }, [data]);
  const save = useMutation({
    mutationFn: () => setOpsSettings(draft!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ops-settings"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  if (isLoading || !draft) return <div className="luxe-card rounded-xl p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>;
  return (
    <div className="luxe-card rounded-xl p-5 space-y-4">
      <h3 className="font-display text-lg md:text-xl">Operations</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Check-In Time"><input type="time" className={inputCls} value={draft.check_in_time} onChange={(e) => setDraft({ ...draft, check_in_time: e.target.value })} /></Field>
        <Field label="Check-Out Time"><input type="time" className={inputCls} value={draft.check_out_time} onChange={(e) => setDraft({ ...draft, check_out_time: e.target.value })} /></Field>
        <Field label="Currency"><input className={inputCls} value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} /></Field>
        <Field label="Timezone"><input className={inputCls} value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end pt-2">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-5 py-2 text-xs font-medium disabled:opacity-60">
          {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div className="space-y-1.5"><div className={labelCls}>{label}</div>{children}</div>);
}
