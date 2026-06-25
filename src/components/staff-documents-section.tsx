import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload, Trash2, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  listStaffDocuments, uploadStaffDocument, signedStaffDocumentUrl, deleteStaffDocument,
  STAFF_DOC_TYPES, type StaffDocType, type StaffDocumentRow,
} from "@/lib/staff-documents-api";
import { useUserRole } from "@/hooks/use-role";

const ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

export function StaffDocumentsSection({ staffId }: { staffId: string }) {
  const { isAdmin } = useUserRole();
  const qc = useQueryClient();
  const [docType, setDocType] = useState<StaffDocType>(STAFF_DOC_TYPES[0]);
  const [notes, setNotes] = useState("");

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["staff-documents", staffId],
    queryFn: () => listStaffDocuments(staffId),
    enabled: !!staffId && isAdmin,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) {
        throw new Error("Only PDF, JPG, PNG files are allowed");
      }
      if (file.size > 10 * 1024 * 1024) throw new Error("File must be 10 MB or smaller");
      return uploadStaffDocument({ staff_id: staffId, doc_type: docType, file, notes: notes || undefined });
    },
    onSuccess: () => {
      toast.success("Document uploaded");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["staff-documents", staffId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Upload failed"),
  });

  const del = useMutation({
    mutationFn: deleteStaffDocument,
    onSuccess: () => {
      toast.success("Document deleted");
      qc.invalidateQueries({ queryKey: ["staff-documents", staffId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  async function openSigned(row: StaffDocumentRow) {
    try {
      const url = await signedStaffDocumentUrl(row.file_path);
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to open");
    }
  }

  if (!isAdmin) {
    return (
      <div className="text-xs text-muted-foreground italic">
        Only Owners or Admins may view or manage staff documents.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Upload document</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <select
            className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
            value={docType}
            onChange={(e) => setDocType(e.target.value as StaffDocType)}
          >
            {STAFF_DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm sm:col-span-2"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <label className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-gold/40 text-gold text-xs hover:bg-gold/10 cursor-pointer w-full sm:w-auto">
          <Upload className="h-3.5 w-3.5" />
          {upload.isPending ? "Uploading…" : "Choose file (PDF, JPG, PNG)"}
          <input
            type="file"
            accept={ACCEPT}
            disabled={upload.isPending}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <div className="rounded-md border border-border bg-card">
        <div className="px-3 py-2 border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
          <span>Documents on file</span>
          <span>{docs.length}</span>
        </div>
        {isLoading ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
          </div>
        ) : docs.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            <FileText className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
            No documents uploaded yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {docs.map((d) => (
              <li key={d.id} className="px-3 py-2 flex items-center gap-3 text-xs">
                <FileText className="h-4 w-4 text-gold flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{d.doc_type}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {d.file_name} · {new Date(d.uploaded_at).toLocaleDateString("en-IN")}
                    {d.notes ? ` · ${d.notes}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => openSigned(d)}
                  className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  title="Open / Download"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete ${d.doc_type} — ${d.file_name}?`)) del.mutate(d);
                  }}
                  className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground italic">
        Staff documents are permanently retained while the staff record exists. Deleting a staff record also deletes all associated documents from storage.
      </p>
    </div>
  );
}
