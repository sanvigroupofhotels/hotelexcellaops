import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Camera, Upload, Trash2, Eye, Loader2, FileImage } from "lucide-react";
import {
  GUEST_DOC_TYPES, type GuestDocType,
  createGuestDocument, listGuestDocuments, listCustomerGuestDocuments,
  softDeleteGuestDocument, signedUrlForPath,
  type GuestDocumentRow,
} from "@/lib/guest-documents-api";
import {
  listPortalDocuments, uploadPortalDocument,
} from "@/lib/portal.functions";
import { useUserRole } from "@/hooks/use-role";
import { useAuth } from "@/lib/auth";

type Mode = "checkin" | "manage";

interface Props {
  /** Provide one of bookingId or customerId. Booking takes precedence when both set. */
  bookingId?: string | null;
  customerId?: string | null;
  /** When provided, the dialog operates in Guest Portal mode (no auth required;
   *  uses signed token-scoped server functions). */
  portalToken?: string | null;
  open: boolean;
  onClose: () => void;
  mode: Mode;
  /** Called after a successful required-document upload in check-in mode. */
  onComplete?: () => void;
  /** Origin label stored against the document. Defaults to "Reception" (PMS) or "Guest Portal" (portal). */
  source?: string;
}

async function fileToBase64(file: File): Promise<{ name: string; mime: string; base64: string }> {
  const buf = await file.arrayBuffer();
  // Convert ArrayBuffer → base64 in the browser without Buffer.
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  const base64 = typeof btoa !== "undefined" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
  return { name: file.name, mime: file.type || "image/jpeg", base64 };
}

export function GuestDocumentsDialog({ bookingId, customerId, portalToken, open, onClose, mode, onComplete, source }: Props) {
  const qc = useQueryClient();
  const { isAdmin } = useUserRole();
  const { user } = useAuth();
  const isPortal = !!portalToken;

  // Server functions for portal mode
  const portalList = useServerFn(listPortalDocuments);
  const portalUpload = useServerFn(uploadPortalDocument);

  const scopeKey = isPortal
    ? ["guest-documents", "portal", portalToken]
    : bookingId
      ? ["guest-documents", bookingId]
      : ["guest-documents", "customer", customerId];

  const { data: docs = [], isLoading } = useQuery({
    queryKey: scopeKey,
    queryFn: async () => {
      if (isPortal) {
        const rows = await portalList({ data: { token: portalToken! } });
        return rows as unknown as GuestDocumentRow[];
      }
      return bookingId
        ? listGuestDocuments(bookingId)
        : listCustomerGuestDocuments(customerId!);
    },
    enabled: open && (isPortal ? !!portalToken : !!(bookingId || customerId)),
  });

  const [docType, setDocType] = useState<GuestDocType>("Aadhaar");
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [notes, setNotes] = useState("");

  const hasExistingFront = docs.some((d) => !!d.front_path);

  useEffect(() => {
    if (!open) {
      setDocType("Aadhaar"); setFront(null); setBack(null); setSelfie(null); setNotes("");
    }
  }, [open]);

  const save = useMutation({
    mutationFn: async () => {
      if (isPortal) {
        if (!front && !back && !selfie) throw new Error("Please choose at least one file to upload");
        if (!front && !hasExistingFront) throw new Error("Front side is mandatory");
        const payload: any = {
          token: portalToken!,
          doc_type: docType,
          notes,
        };
        if (front) payload.front = await fileToBase64(front);
        if (back) payload.back = await fileToBase64(back);
        if (selfie) payload.selfie = await fileToBase64(selfie);
        return portalUpload({ data: payload });
      }
      return createGuestDocument({
        bookingId: bookingId ?? null, customerId: customerId ?? null,
        docType, front, back, selfie, notes,
        uploadedByName: user?.email ?? "Staff",
        source: source ?? "Reception",
        allowMissingFront: hasExistingFront,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guest-documents"] });
      toast.success("Document uploaded");
      setFront(null); setBack(null); setSelfie(null); setNotes("");
      if (mode === "checkin") { onComplete?.(); onClose(); }
    },
    onError: (e: any) => toast.error(e?.message ?? "Upload failed"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      if (isPortal) throw new Error("Document removal is not available in the Guest Portal.");
      return softDeleteGuestDocument(id, user?.email ?? "Staff");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guest-documents"] });
      toast.success("Document removed");
    },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  const openSignedUrl = async (path: string) => {
    if (isPortal) {
      toast.error("Previously uploaded IDs are not viewable in the Guest Portal.");
      return;
    }
    const url = await signedUrlForPath(path);
    if (url) window.open(url, "_blank");
    else toast.error("Could not generate file link");
  };

  const canManage = isPortal ? true : (isAdmin || true);
  const anyPicked = !!(front || back || selfie);
  const canUpload = anyPicked && (!!front || hasExistingFront);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Guest Documents</DialogTitle>
          <DialogDescription>
            {mode === "checkin"
              ? "Capture or upload Guest ID before completing Check-In."
              : isPortal
                ? "Upload your ID securely. Uploaded documents stay on your profile for future stays."
                : "Upload, view, or remove guest identity documents."}
          </DialogDescription>
        </DialogHeader>

        {/* Existing documents — hidden in portal mode for guest privacy.
            Guests can still upload / replace, but cannot view, preview, or
            download IDs previously stored on their booking. */}
        {!isPortal && (
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">On file</div>
            {isLoading ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
            ) : docs.length === 0 ? (
              <div className="text-sm text-muted-foreground italic">No documents uploaded yet.</div>
            ) : (
              <div className="space-y-2">
                {docs.map((d) => (
                  <DocRow key={d.id} doc={d} onOpen={openSignedUrl} onDelete={canManage ? () => del.mutate(d.id) : undefined} />
                ))}
              </div>
            )}
          </div>
        )}
        {isPortal && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-muted-foreground">
            For your security, previously uploaded IDs are not viewable in the
            portal. You can upload new or replacement documents below — they will
            be stored securely on your booking.
            {docs.length > 0 && (
              <span className="block mt-1 text-foreground">
                {docs.length} document{docs.length === 1 ? "" : "s"} on file.
              </span>
            )}
          </div>
        )}

        {/* Upload form */}
        <div className="rounded-md border border-border bg-card/40 p-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Add new document</div>

          <div>
            <Label className="text-xs">ID Type</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {GUEST_DOC_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => setDocType(t)}
                  className={`rounded-full border px-3 py-1 text-[11px] ${docType === t ? "border-gold bg-gold-soft/40" : "border-border bg-card hover:border-gold/40"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <FileSlot
            label="Front Side"
            required={!hasExistingFront}
            value={front}
            onChange={setFront}
            hint={hasExistingFront ? "Already on file — optional" : undefined}
          />
          <FileSlot label="Back Side" value={back} onChange={setBack} hint="Optional" />
          <FileSlot label="Guest Photo / Selfie" value={selfie} onChange={setSelfie} hint="Optional" />

          <div>
            <Label className="text-xs">Notes</Label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="mt-1 w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
              placeholder="Optional — anything to record about the ID" />
          </div>

          <Button type="button" onClick={() => save.mutate()} disabled={!canUpload || save.isPending} className="w-full">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload Document
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Close</Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}

function FileSlot({
  label, value, onChange, required, hint,
}: { label: string; value: File | null; onChange: (f: File | null) => void; required?: boolean; hint?: string }) {
  return (
    <div>
      <Label className="text-xs">
        {label} {required ? <span className="text-destructive">*</span> : hint ? <span className="text-muted-foreground">({hint})</span> : null}
      </Label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40">
          <Upload className="h-3.5 w-3.5" /> Upload Image
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40">
          <Camera className="h-3.5 w-3.5" /> Capture Photo
          <input type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
        </label>
        {value && (
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <FileImage className="h-3 w-3" /> {value.name}
            <button type="button" onClick={() => onChange(null)} className="ml-1 text-destructive hover:underline">Remove</button>
          </span>
        )}
      </div>
    </div>
  );
}

function DocRow({ doc, onOpen, onDelete }: { doc: GuestDocumentRow; onOpen: (path: string) => void; onDelete?: () => void }) {
  const files = [
    { key: "Front", path: doc.front_path },
    { key: "Back", path: doc.back_path },
    { key: "Selfie", path: doc.selfie_path },
  ].filter((f) => !!f.path) as { key: string; path: string }[];
  const verified = !!(doc as any).verified_at;
  return (
    <div className="rounded-md border border-border bg-card/30 p-3 text-xs space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-sm flex items-center gap-2">
          {doc.doc_type}
          {verified && (
            <span className="rounded-full border border-success/40 bg-success/10 text-success text-[10px] px-2 py-0.5">Verified</span>
          )}
          {(doc as any).source && (
            <span className="rounded-full border border-border bg-card text-muted-foreground text-[10px] px-2 py-0.5">{(doc as any).source}</span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground">
          By {doc.uploaded_by_name ?? "—"} · {new Date(doc.uploaded_at).toLocaleString("en-IN")}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {files.length === 0 && <span className="text-muted-foreground italic">No files attached</span>}
        {files.map((f) => (
          <button key={f.key} type="button" onClick={() => onOpen(f.path)}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 hover:border-gold/40">
            <Eye className="h-3 w-3" /> {f.key}
          </button>
        ))}
        {onDelete && (
          <button type="button" onClick={onDelete}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-destructive hover:bg-destructive/20">
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        )}
      </div>
      {doc.notes && <div className="text-[11px] text-muted-foreground">{doc.notes}</div>}
    </div>
  );
}
