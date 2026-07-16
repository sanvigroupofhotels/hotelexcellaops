import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrandingSettings, setBrandingSettings, type BrandingSettings } from "@/lib/app-settings-api";
import { toast } from "sonner";
import { Loader2, Upload, X, RefreshCw, Check, Scissors } from "lucide-react";
import { cn } from "@/lib/utils";
import { fileToDataURL, processSignature, type SignatureProcessResult } from "@/lib/signature-processor";

export const Route = createFileRoute("/_authenticated/settings/branding")({ component: BrandingPage });

const inputCls = "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40";
const labelCls = "text-[11px] uppercase tracking-wider text-muted-foreground";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB raw upload accepted; processing shrinks it.

function BrandingPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["branding-settings"], queryFn: getBrandingSettings });
  const [draft, setDraft] = useState<BrandingSettings | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewData, setReviewData] = useState<SignatureProcessResult | null>(null);
  const [processing, setProcessing] = useState(false);
  useEffect(() => { if (data) setDraft(data); }, [data]);

  const save = useMutation({
    mutationFn: () => setBrandingSettings(draft!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["branding-settings"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  const runProcess = async (originalDataUrl: string, crop?: { x: number; y: number; w: number; h: number }) => {
    setProcessing(true);
    try {
      const out = await processSignature(originalDataUrl, { crop });
      setReviewData(out);
      setReviewOpen(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not process signature");
    } finally {
      setProcessing(false);
    }
  };

  const onPickSignature = async (file: File | null) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.error("Please upload a PNG, JPG, or WebP file.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`Please upload a file under ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`);
      return;
    }
    try {
      const original = await fileToDataURL(file);
      await runProcess(original);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load image");
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
        <p className="text-[11px] text-muted-foreground">
          Upload any signature — HEOS automatically removes the paper background, trims the whitespace,
          and produces a clean transparent PNG for every printed document. You'll review the result before it's saved.
        </p>
        <div className="flex items-start gap-4 flex-wrap">
          {draft.signature_url ? (
            <div className="relative">
              <img src={draft.signature_url} alt="Authorised signature"
                className="h-20 w-auto max-w-[220px] rounded border border-border object-contain p-1"
                style={{ background: "repeating-conic-gradient(#e5e7eb 0% 25%, #ffffff 0% 50%) 50% / 12px 12px" }} />
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
          <label className="inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40 disabled:opacity-60">
            {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {draft.signature_url ? "Replace" : "Upload"} Signature
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              disabled={processing}
              onChange={(e) => { const f = e.target.files?.[0] ?? null; e.currentTarget.value = ""; void onPickSignature(f); }} />
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

      {reviewOpen && reviewData && (
        <SignatureReview
          result={reviewData}
          onAccept={() => {
            setDraft({ ...draft, signature_url: reviewData.dataUrl });
            setReviewOpen(false);
            setReviewData(null);
            toast.success("Signature processed. Remember to Save.");
          }}
          onReprocess={(crop) => runProcess(reviewData.originalDataUrl, crop)}
          onCancel={() => { setReviewOpen(false); setReviewData(null); }}
          processing={processing}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div className="space-y-1.5"><div className={labelCls}>{label}</div>{children}</div>);
}

/* ─────────────────────── Signature Review Modal ─────────────────────── */

function SignatureReview({
  result, onAccept, onReprocess, onCancel, processing,
}: {
  result: SignatureProcessResult;
  onAccept: () => void;
  onReprocess: (crop?: { x: number; y: number; w: number; h: number }) => void;
  onCancel: () => void;
  processing: boolean;
}) {
  const [cropMode, setCropMode] = useState(false);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="luxe-card rounded-xl p-5 w-full max-w-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="font-display text-lg">Review Processed Signature</h4>
            <p className="text-[11px] text-muted-foreground">
              Compare the original upload with the processed result. Accept to save, or reprocess with a manual crop for a cleaner isolation.
            </p>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-md hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        {result.lowConfidence && !cropMode && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 text-amber-500 text-xs p-3">
            The signature could not be isolated cleanly. Try <b>Select Region</b> to crop just the signature before reprocessing.
          </div>
        )}

        {!cropMode ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PreviewTile label="Original Upload" src={result.originalDataUrl} checker={false} />
            <PreviewTile label="Processed" src={result.dataUrl} checker />
          </div>
        ) : (
          <CropSelector src={result.originalDataUrl} onCancel={() => setCropMode(false)}
            onConfirm={(crop) => { setCropMode(false); onReprocess(crop); }} />
        )}

        {!cropMode && (
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border/60">
            <button onClick={onCancel}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs">
              Upload Different Image
            </button>
            <button onClick={() => setCropMode(true)} disabled={processing}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs disabled:opacity-60">
              <Scissors className="h-3.5 w-3.5" /> Select Region
            </button>
            <button onClick={() => onReprocess()} disabled={processing}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs disabled:opacity-60">
              {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Reprocess
            </button>
            <button onClick={onAccept} disabled={processing}
              className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-4 py-2 text-xs font-medium disabled:opacity-60">
              <Check className="h-3.5 w-3.5" /> Accept & Use
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewTile({ label, src, checker }: { label: string; src: string; checker: boolean }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="rounded-md border border-border h-40 flex items-center justify-center overflow-hidden"
        style={checker
          ? { background: "repeating-conic-gradient(#e5e7eb 0% 25%, #ffffff 0% 50%) 50% / 14px 14px" }
          : { background: "#fff" }}>
        <img src={src} alt={label} className="max-h-full max-w-full object-contain" />
      </div>
    </div>
  );
}

/* Simple rectangle-crop selector: drag on the image to pick a region. */
function CropSelector({ src, onConfirm, onCancel }: {
  src: string;
  onConfirm: (crop: { x: number; y: number; w: number; h: number }) => void;
  onCancel: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  const toLocal = (e: React.PointerEvent) => {
    const el = wrapRef.current!;
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = toLocal(e);
    setDragStart(p);
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragStart) return;
    const p = toLocal(e);
    setRect({
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      w: Math.abs(p.x - dragStart.x),
      h: Math.abs(p.y - dragStart.y),
    });
  };
  const onUp = () => setDragStart(null);

  const confirm = () => {
    const img = imgRef.current;
    if (!img || !rect || rect.w < 6 || rect.h < 6) {
      onCancel();
      return;
    }
    const sx = img.naturalWidth / img.clientWidth;
    const sy = img.naturalHeight / img.clientHeight;
    onConfirm({
      x: Math.round(rect.x * sx),
      y: Math.round(rect.y * sy),
      w: Math.round(rect.w * sx),
      h: Math.round(rect.h * sy),
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Drag on the image to draw a rectangle around just the signature, then confirm.
      </p>
      <div ref={wrapRef}
        className="relative inline-block max-w-full rounded-md border border-border bg-white overflow-hidden touch-none select-none"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <img ref={imgRef} src={src} alt="Crop original"
          draggable={false}
          className="block max-h-[60vh] w-auto pointer-events-none" />
        {rect && (
          <div className="absolute border-2 border-gold bg-gold/10 pointer-events-none"
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs">
          Cancel
        </button>
        <button onClick={confirm} disabled={!rect || rect.w < 6 || rect.h < 6}
          className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-4 py-2 text-xs font-medium disabled:opacity-60">
          <Check className="h-3.5 w-3.5" /> Use This Region
        </button>
      </div>
    </div>
  );
}
