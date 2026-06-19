import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrandingSettings, setBrandingSettings, type BrandingSettings } from "@/lib/app-settings-api";
import { toast } from "sonner";
import { Loader2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings/branding")({ component: BrandingPage });

const inputCls = "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40";
const labelCls = "text-[11px] uppercase tracking-wider text-muted-foreground";

const MAX_SIG_BYTES = 200 * 1024; // 200 KB raw; data URL is ~33% larger

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(new Error("Could not read file"));
    fr.readAsDataURL(file);
  });
}

function BrandingPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["branding-settings"], queryFn: getBrandingSettings });
  const [draft, setDraft] = useState<BrandingSettings | null>(null);
  useEffect(() => { if (data) setDraft(data); }, [data]);
  const save = useMutation({
    mutationFn: () => setBrandingSettings(draft!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["branding-settings"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  const onPickSignature = async (file: File | null) => {
    if (!file || !draft) return;
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) {
      toast.error("Please upload a PNG, JPG, WebP or SVG file");
      return;
    }
    if (file.size > MAX_SIG_BYTES) {
      toast.error(`Signature must be under ${Math.round(MAX_SIG_BYTES / 1024)} KB. Compress and try again.`);
      return;
    }
    try {
      const dataUrl = await fileToDataURL(file);
      setDraft({ ...draft, signature_url: dataUrl });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load image");
    }
  };

  if (isLoading || !draft) return <div className="luxe-card rounded-xl p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>;
  return (
    <div className="luxe-card rounded-xl p-5 space-y-4">
      <h3 className="font-display text-lg md:text-xl">Branding</h3>
      <Field label="Guest Portal Title"><input className={inputCls} value={draft.portal_title} onChange={(e) => setDraft({ ...draft, portal_title: e.target.value })} /></Field>
      <Field label="Welcome Message"><textarea className={cn(inputCls, "min-h-[80px]")} value={draft.welcome_message} onChange={(e) => setDraft({ ...draft, welcome_message: e.target.value })} /></Field>
      <Field label="Invoice Footer"><textarea className={cn(inputCls, "min-h-[80px]")} value={draft.invoice_footer} onChange={(e) => setDraft({ ...draft, invoice_footer: e.target.value })} /></Field>

      <div className="space-y-1.5 pt-2 border-t border-border">
        <div className={labelCls}>Authorised Signature (Invoice + Proforma)</div>
        <p className="text-[11px] text-muted-foreground">PNG/JPG/SVG up to 200 KB. Rendered bottom-right of every Invoice and Proforma. Leave empty to hide.</p>
        <div className="flex items-start gap-4">
          {draft.signature_url ? (
            <div className="relative">
              <img src={draft.signature_url} alt="Authorised signature"
                className="h-20 w-auto max-w-[220px] bg-white rounded border border-border object-contain p-1" />
              <button onClick={() => setDraft({ ...draft, signature_url: "" })}
                className="absolute -top-2 -right-2 rounded-full bg-destructive text-destructive-foreground p-0.5 shadow"
                title="Remove signature">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="h-20 w-[220px] rounded border border-dashed border-border flex items-center justify-center text-[11px] text-muted-foreground">
              No signature uploaded
            </div>
          )}
          <label className="inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40">
            <Upload className="h-3.5 w-3.5" /> {draft.signature_url ? "Replace" : "Upload"} Signature
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
              onChange={(e) => onPickSignature(e.target.files?.[0] ?? null)} />
          </label>
        </div>
      </div>

      <Field label="Signatory Designation">
        <input className={inputCls} value={draft.signatory_designation}
          onChange={(e) => setDraft({ ...draft, signatory_designation: e.target.value })}
          placeholder="Authorised Signatory · Hotel Excella" />
      </Field>

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
