import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDocumentsRetention, setDocumentsRetention,
  DOCUMENTS_RETENTION_OPTIONS, type DocumentsRetentionSettings,
} from "@/lib/app-settings-api";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings/documents")({ component: DocsRetentionPage });

function DocsRetentionPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["documents-retention"], queryFn: getDocumentsRetention });
  const [draft, setDraft] = useState<DocumentsRetentionSettings | null>(null);
  useEffect(() => { if (data) setDraft(data); }, [data]);
  const save = useMutation({
    mutationFn: () => setDocumentsRetention(draft!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["documents-retention"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  if (isLoading || !draft) return <div className="luxe-card rounded-xl p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>;

  return (
    <div className="luxe-card rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-gold mt-0.5" />
        <div>
          <h3 className="font-display text-lg md:text-xl">Documents Retention</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Guest ID documents are automatically purged after the configured period.
            Cancelled or deleted bookings purge their documents immediately on the next cleanup run.
            Only Admin / Owner can change this.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Retention period</div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {DOCUMENTS_RETENTION_OPTIONS.map((opt) => {
            const active = draft.retention_days === opt.days;
            return (
              <button key={opt.days} type="button"
                onClick={() => setDraft({ retention_days: opt.days })}
                className={cn("rounded-md border px-3 py-2.5 text-xs text-center transition",
                  active
                    ? "border-gold bg-gold-soft/40 text-foreground"
                    : "border-border bg-card hover:border-gold/40 text-muted-foreground hover:text-foreground")}>
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Current selection:{" "}
          <span className="text-foreground">
            {draft.retention_days === 0 ? "Never delete" : `${draft.retention_days} days`}
          </span>
        </p>
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
