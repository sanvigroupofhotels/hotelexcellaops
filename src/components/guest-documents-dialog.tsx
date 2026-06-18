import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Camera, Upload, Trash2, Eye, Loader2, FileImage, Clock } from "lucide-react";
import {
  GUEST_DOC_TYPES, type GuestDocType,
  createGuestDocument, listGuestDocuments, softDeleteGuestDocument, signedUrlForPath,
  type GuestDocumentRow,
} from "@/lib/guest-documents-api";
import { useUserRole } from "@/hooks/use-role";
import { useAuth } from "@/lib/auth";

type Mode = "checkin" | "manage";

interface Props {
  bookingId: string;
  open: boolean;
  onClose: () => void;
  mode: Mode;
  /** Called when the user completes (uploaded OR chose Upload Later) in check-in mode. */
  onComplete?: () => void;
}

export function GuestDocumentsDialog({ bookingId, open, onClose, mode, onComplete }: Props) {
  const qc = useQueryClient();
  const { isAdmin } = useUserRole();
  const { user } = useAuth();

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["guest-documents", bookingId],
    queryFn: () => listGuestDocuments(bookingId),
    enabled: open,
  });

  const [docType, setDocType] = useState<GuestDocType>("Aadhaar");
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [notes, setNotes] = useState("");

  // If a previously uploaded doc already has a Front Side on file, the
  // mandatory-front requirement is treated as satisfied — staff may add Back
  // or Selfie alone without being forced to re-upload Front.
  const hasExistingFront = docs.some((d) => !!d.front_path);

  useEffect(() => {
    if (!open) {
      setDocType("Aadhaar"); setFront(null); setBack(null); setSelfie(null); setNotes("");
    }
  }, [open]);

  const save = useMutation({
    mutationFn: () => createGuestDocument({
      bookingId, docType, front, back, selfie, notes,
      uploadedByName: user?.email ?? "Staff",
      allowMissingFront: hasExistingFront,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guest-documents", bookingId] });
      toast.success("Document uploaded");
      setFront(null); setBack(null); setSelfie(null); setNotes("");
      if (mode === "checkin") { onComplete?.(); onClose(); }
    },
    onError: (e: any) => toast.error(e?.message ?? "Upload failed"),
  });

  const del = useMutation({
    mutationFn: (id: string) => softDeleteGuestDocument(id, user?.email ?? "Staff"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guest-documents", bookingId] });
      toast.success("Document removed");
    },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  const canManage = isAdmin || true; // any signed-in staff allowed per spec

  const anyPicked = !!(front || back || selfie);
  const canUpload = anyPicked && (!!front || hasExistingFront);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Guest Documents</DialogTitle>
          <DialogDescription>
            {mode === "checkin"
              ? "Capture or upload Guest ID. You may skip and upload later — Check-In is not blocked."
              : "Upload, view, or remove guest identity documents. Files auto-purge after 60 days."}
          </DialogDescription>
        </DialogHeader>

        {/* Existing documents */}
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">On file</div>
          {isLoading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
          ) : docs.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">No documents uploaded yet.</div>
          ) : (
            <div className="space-y-2">
              {docs.map((d) => (
                <DocRow key={d.id} doc={d} onDelete={canManage ? () => del.mutate(d.id) : undefined} />
              ))}
            </div>
          )}
        </div>

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
          {mode === "checkin" ? (
            <>
              <Button variant="outline" onClick={() => { onComplete?.(); onClose(); }}>
                <Clock className="h-4 w-4" /> Upload Later
              </Button>
              <Button onClick={() => { onComplete?.(); onClose(); }} disabled={save.isPending}>
                Continue to Check-In
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose}>Close</Button>
          )}
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

function DocRow({ doc, onDelete }: { doc: GuestDocumentRow; onDelete?: () => void }) {
  const open = async (path: string | null) => {
    if (!path) return;
    const url = await signedUrlForPath(path);
    if (url) window.open(url, "_blank");
    else toast.error("Could not generate file link");
  };
  const files = [
    { key: "Front", path: doc.front_path },
    { key: "Back", path: doc.back_path },
    { key: "Selfie", path: doc.selfie_path },
  ].filter((f) => f.path);
  return (
    <div className="rounded-md border border-border bg-card/30 p-3 text-xs space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-sm">{doc.doc_type}</div>
        <div className="text-[10px] text-muted-foreground">
          By {doc.uploaded_by_name ?? "—"} · {new Date(doc.uploaded_at).toLocaleString("en-IN")}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {files.length === 0 && <span className="text-muted-foreground italic">No files attached</span>}
        {files.map((f) => (
          <button key={f.key} type="button" onClick={() => open(f.path)}
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
