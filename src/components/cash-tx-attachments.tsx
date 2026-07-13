/**
 * Cash Book bill/receipt attachments (UAT-031).
 *
 * Two use-sites:
 *  - `Panel` inside the Add/Edit Cash Tx modal — enforces the mandatory rule
 *    for FO Staff on Cash Out > ₹300 (owner/admin bypass at the UI layer;
 *    RLS also permits their write).
 *  - `Viewer` inside the Cash Tx Detail modal — read + full-screen lightbox
 *    for images, download/open-in-new-tab for PDFs.
 *
 * Every add/replace/delete is captured in `cash_tx_activities` via
 * `src/lib/cash-api.ts`, so the History view already renders them without
 * further wiring.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Paperclip, Upload, Camera, Eye, Trash2, Replace, Loader2, FileText, ImageIcon, Download,
} from "lucide-react";
import {
  listCashTxAttachments, uploadCashTxAttachment, deleteCashTxAttachment,
  replaceCashTxAttachment, signedCashTxAttachmentUrl,
  CASH_OUT_ATTACHMENT_THRESHOLD_INR,
  type CashTxAttachment,
} from "@/lib/cash-api";
import { ImageLightbox } from "@/components/image-lightbox";

/** Local staged file (used pre-save when the tx row does not yet exist). */
export interface StagedAttachment {
  id: string;
  file: File;
  previewUrl: string;
  isPdf: boolean;
}

const isImageMime = (m: string) => m.startsWith("image/");
const isPdfMime = (m: string) => m === "application/pdf" || m.endsWith("/pdf");

function fileButtonBase(disabled?: boolean) {
  return `inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40 min-h-[36px] ${disabled ? "opacity-50 pointer-events-none" : ""}`;
}

/**
 * Add-modal attachments panel. Supports two states:
 *   1. `txId` is provided → attachments persist immediately via the API.
 *   2. `txId` is null (creating a NEW tx) → attachments are staged locally in
 *      `staged` and flushed by the parent AFTER the tx row is created.
 *
 * The parent reads `attachmentCount` (persisted + staged) to enforce the
 * mandatory rule.
 */
export function CashTxAttachmentsPanel({
  txId, staged, onStagedChange, disabled,
}: {
  txId: string | null;
  staged: StagedAttachment[];
  onStagedChange: (next: StagedAttachment[]) => void;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);

  const { data: persisted = [] } = useQuery({
    queryKey: ["cash-tx-attachments", txId],
    queryFn: () => listCashTxAttachments(txId!),
    enabled: !!txId,
  });

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    for (const f of arr) {
      const isImg = isImageMime(f.type);
      const isPdf = isPdfMime(f.type);
      if (!isImg && !isPdf) {
        toast.error(`${f.name}: only images and PDFs are supported`);
        return;
      }
      if (f.size > 15 * 1024 * 1024) {
        toast.error(`${f.name}: over 15 MB`);
        return;
      }
    }
    if (txId) {
      setBusy(true);
      try {
        for (const f of arr) await uploadCashTxAttachment(txId, f);
        qc.invalidateQueries({ queryKey: ["cash-tx-attachments", txId] });
        qc.invalidateQueries({ queryKey: ["cash-tx-activities", txId] });
        toast.success(arr.length === 1 ? "Attachment added" : `${arr.length} attachments added`);
      } catch (e: any) {
        toast.error(e?.message ?? "Upload failed");
      } finally {
        setBusy(false);
      }
    } else {
      const next: StagedAttachment[] = arr.map((f) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
        isPdf: isPdfMime(f.type),
      }));
      onStagedChange([...staged, ...next]);
    }
  };

  const removeStaged = (id: string) => {
    const gone = staged.find((s) => s.id === id);
    if (gone) URL.revokeObjectURL(gone.previewUrl);
    onStagedChange(staged.filter((s) => s.id !== id));
  };

  const removePersisted = async (a: CashTxAttachment) => {
    if (!confirm("Remove this attachment?")) return;
    setBusy(true);
    try {
      await deleteCashTxAttachment(a.id);
      qc.invalidateQueries({ queryKey: ["cash-tx-attachments", a.tx_id] });
      qc.invalidateQueries({ queryKey: ["cash-tx-activities", a.tx_id] });
      toast.success("Attachment removed");
    } catch (e: any) { toast.error(e?.message ?? "Delete failed"); }
    finally { setBusy(false); }
  };

  const replacePersisted = async (a: CashTxAttachment, file: File) => {
    setBusy(true);
    try {
      await replaceCashTxAttachment(a.id, file);
      qc.invalidateQueries({ queryKey: ["cash-tx-attachments", a.tx_id] });
      qc.invalidateQueries({ queryKey: ["cash-tx-activities", a.tx_id] });
      toast.success("Attachment replaced");
    } catch (e: any) { toast.error(e?.message ?? "Replace failed"); }
    finally { setBusy(false); }
  };

  const openImageAt = async (index: number) => {
    // Build a list of signed URLs for all image attachments (persisted +
    // staged) so the lightbox can flip through them.
    const persistedImgs = persisted.filter((a) => isImageMime(a.mime_type));
    const persistedUrls: string[] = [];
    for (const a of persistedImgs) {
      const url = await signedCashTxAttachmentUrl(a.storage_path);
      if (url) persistedUrls.push(url);
    }
    const stagedImgs = staged.filter((s) => !s.isPdf).map((s) => s.previewUrl);
    setLightbox({ urls: [...persistedUrls, ...stagedImgs], index });
  };

  const openPdf = async (a: CashTxAttachment) => {
    const url = await signedCashTxAttachmentUrl(a.storage_path, 300);
    if (url) window.open(url, "_blank"); else toast.error("Could not open PDF");
  };

  const totalCount = persisted.length + staged.length;

  return (
    <div className="rounded-md border border-border bg-card/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5 text-gold" /> Bill Attachments
        </div>
        <div className="text-[10px] text-muted-foreground">{totalCount || 0} file{totalCount === 1 ? "" : "s"}</div>
      </div>

      {/* Existing (persisted) attachments */}
      {persisted.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {persisted.map((a, i) => (
            <PersistedTile
              key={a.id} a={a} index={i}
              onOpenImage={() => openImageAt(i)}
              onOpenPdf={() => openPdf(a)}
              onDelete={() => removePersisted(a)}
              onReplace={(file) => replacePersisted(a, file)}
              disabled={disabled || busy}
            />
          ))}
        </div>
      )}

      {/* Staged attachments (not yet uploaded) */}
      {staged.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {staged.map((s, i) => (
            <div key={s.id} className="relative rounded-md border border-dashed border-gold/40 bg-card p-2 flex flex-col items-center gap-1">
              {s.isPdf ? (
                <div className="h-16 w-full flex items-center justify-center text-muted-foreground"><FileText className="h-8 w-8" /></div>
              ) : (
                <img src={s.previewUrl} alt="preview"
                  onClick={() => openImageAt(persisted.filter((a) => isImageMime(a.mime_type)).length + i)}
                  className="h-16 w-full object-cover rounded cursor-zoom-in" />
              )}
              <div className="w-full text-[10px] truncate text-center" title={s.file.name}>{s.file.name}</div>
              <button type="button" onClick={() => removeStaged(s.id)}
                className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive text-white p-0.5">
                <Trash2 className="h-3 w-3" />
              </button>
              <span className="text-[9px] uppercase tracking-wider text-gold/80">Pending upload</span>
            </div>
          ))}
        </div>
      )}

      {totalCount === 0 && (
        <p className="text-[11px] text-muted-foreground italic">No attachments yet.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <label className={fileButtonBase(disabled || busy)}>
          <Upload className="h-3.5 w-3.5" /> Upload
          <input type="file" accept="image/*,application/pdf" multiple className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.currentTarget.value = ""; }} />
        </label>
        <label className={fileButtonBase(disabled || busy)}>
          <Camera className="h-3.5 w-3.5" /> Capture
          <input type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.currentTarget.value = ""; }} />
        </label>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-gold self-center" />}
      </div>

      {lightbox && (
        <ImageLightbox urls={lightbox.urls} index={lightbox.index} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

function PersistedTile({
  a, index, onOpenImage, onOpenPdf, onDelete, onReplace, disabled,
}: {
  a: CashTxAttachment;
  index: number;
  onOpenImage: () => void;
  onOpenPdf: () => void;
  onDelete: () => void;
  onReplace: (f: File) => void;
  disabled?: boolean;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  const isImg = isImageMime(a.mime_type);
  const isPdf = isPdfMime(a.mime_type);

  useMemo(() => {
    if (isImg) {
      signedCashTxAttachmentUrl(a.storage_path, 600).then((u) => u && setThumb(u));
    }
  }, [a.storage_path, isImg]);

  return (
    <div className="relative rounded-md border border-border bg-card p-2 flex flex-col items-center gap-1">
      {isImg ? (
        thumb ? (
          <img src={thumb} alt="bill"
            onClick={onOpenImage}
            className="h-16 w-full object-cover rounded cursor-zoom-in" />
        ) : (
          <div className="h-16 w-full flex items-center justify-center text-muted-foreground"><ImageIcon className="h-6 w-6 animate-pulse" /></div>
        )
      ) : isPdf ? (
        <button type="button" onClick={onOpenPdf}
          className="h-16 w-full flex items-center justify-center text-muted-foreground hover:text-gold">
          <FileText className="h-8 w-8" />
        </button>
      ) : (
        <div className="h-16 w-full flex items-center justify-center text-muted-foreground"><FileText className="h-6 w-6" /></div>
      )}
      <div className="w-full text-[10px] truncate text-center" title={a.original_filename ?? "attachment"}>
        {a.original_filename ?? `attachment-${index + 1}`}
      </div>
      <div className="flex gap-1">
        {isPdf && (
          <button type="button" onClick={onOpenPdf} title="Open PDF"
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground">
            <Download className="h-3 w-3" />
          </button>
        )}
        <label className={`p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer ${disabled ? "opacity-50 pointer-events-none" : ""}`} title="Replace">
          <Replace className="h-3 w-3" />
          <input type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onReplace(f); e.currentTarget.value = ""; }} />
        </label>
        <button type="button" onClick={onDelete} disabled={disabled} title="Remove"
          className="p-1 rounded hover:bg-destructive/15 text-destructive/80 hover:text-destructive">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/** Detail-view: read-only list (with lightbox / open-PDF). */
export function CashTxAttachmentsViewer({ txId }: { txId: string }) {
  const { data: rows = [] } = useQuery({
    queryKey: ["cash-tx-attachments", txId],
    queryFn: () => listCashTxAttachments(txId),
  });
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);

  if (rows.length === 0) return null;

  const openImage = async (index: number) => {
    const imgs = rows.filter((r) => isImageMime(r.mime_type));
    const urls: string[] = [];
    for (const r of imgs) {
      const u = await signedCashTxAttachmentUrl(r.storage_path);
      if (u) urls.push(u);
    }
    setLightbox({ urls, index });
  };

  const openPdf = async (a: CashTxAttachment) => {
    const url = await signedCashTxAttachmentUrl(a.storage_path, 300);
    if (url) window.open(url, "_blank");
  };

  return (
    <div className="border-t border-border pt-4">
      <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
        <Paperclip className="h-4 w-4 text-gold" /> Bill Attachments <span className="text-[11px] text-muted-foreground">({rows.length})</span>
      </h4>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {rows.map((a, i) => (
          <ViewerTile key={a.id} a={a} onOpenImage={() => openImage(i)} onOpenPdf={() => openPdf(a)} />
        ))}
      </div>
      {lightbox && (
        <ImageLightbox urls={lightbox.urls} index={lightbox.index} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

function ViewerTile({ a, onOpenImage, onOpenPdf }: { a: CashTxAttachment; onOpenImage: () => void; onOpenPdf: () => void }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const isImg = isImageMime(a.mime_type);
  const isPdf = isPdfMime(a.mime_type);
  useMemo(() => {
    if (isImg) signedCashTxAttachmentUrl(a.storage_path, 600).then((u) => u && setThumb(u));
  }, [a.storage_path, isImg]);

  return (
    <button type="button" onClick={isImg ? onOpenImage : onOpenPdf}
      className="relative rounded-md border border-border bg-card p-1 flex flex-col items-center gap-1 hover:border-gold/40 transition">
      {isImg ? (
        thumb
          ? <img src={thumb} alt="bill" className="h-20 w-full object-cover rounded" />
          : <div className="h-20 w-full flex items-center justify-center"><ImageIcon className="h-6 w-6 text-muted-foreground animate-pulse" /></div>
      ) : (
        <div className="h-20 w-full flex items-center justify-center"><FileText className="h-8 w-8 text-muted-foreground" /></div>
      )}
      <div className="w-full text-[10px] truncate text-center" title={a.original_filename ?? "attachment"}>
        {a.original_filename ?? "attachment"}
      </div>
      {isPdf && <Eye className="absolute top-1 right-1 h-3 w-3 text-gold" />}
    </button>
  );
}

export function requiresCashOutAttachment(opts: { kind: "collection" | "expense"; amount: number; canBypass: boolean }): boolean {
  return opts.kind === "expense"
    && !opts.canBypass
    && Number(opts.amount) > CASH_OUT_ATTACHMENT_THRESHOLD_INR;
}
