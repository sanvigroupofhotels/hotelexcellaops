import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileImage, Plus, Eye, Loader2 } from "lucide-react";
import { listCustomerGuestDocuments, signedUrlForPath, type GuestDocumentRow } from "@/lib/guest-documents-api";
import { GuestDocumentsDialog } from "@/components/guest-documents-dialog";
import { toast } from "sonner";

export function CustomerDocumentsCard({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["guest-documents", "customer", customerId],
    queryFn: () => listCustomerGuestDocuments(customerId),
  });

  const openFile = async (path: string | null) => {
    if (!path) return;
    const url = await signedUrlForPath(path);
    if (url) window.open(url, "_blank");
    else toast.error("Could not generate file link");
  };

  return (
    <div className="luxe-card rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg">Documents</h3>
          <span className="text-xs text-muted-foreground">{docs.length} on file</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-gold/40 bg-gold-soft text-gold px-3 py-1.5 text-xs font-medium hover:bg-gold/20"
        >
          <Plus className="h-3.5 w-3.5" /> Upload / Manage
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : docs.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No documents on file. Upload Aadhaar, PAN, Passport, Driving License or other ID so it's
          ready for every future stay.
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {docs.map((d) => <DocRow key={d.id} doc={d} onOpen={openFile} />)}
        </div>
      )}

      <GuestDocumentsDialog
        customerId={customerId}
        bookingId={null}
        open={open}
        onClose={() => setOpen(false)}
        mode="manage"
      />
    </div>
  );
}

function DocRow({ doc, onOpen }: { doc: GuestDocumentRow; onOpen: (p: string | null) => void }) {
  const files = [
    { key: "Front", path: doc.front_path },
    { key: "Back", path: doc.back_path },
    { key: "Selfie", path: doc.selfie_path },
  ].filter((f) => f.path);
  const source = doc.booking_id ? `Booking` : "Customer Profile";
  return (
    <div className="px-5 py-3 flex flex-wrap items-center gap-3 text-xs">
      <FileImage className="h-4 w-4 text-gold shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{doc.doc_type}</div>
        <div className="text-[11px] text-muted-foreground">
          {new Date(doc.uploaded_at).toLocaleString("en-IN")} · By {doc.uploaded_by_name ?? "—"} · Source: {source}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {files.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onOpen(f.path)}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 hover:border-gold/40"
          >
            <Eye className="h-3 w-3" /> {f.key}
          </button>
        ))}
        <span className="inline-flex items-center rounded-full border border-success/40 bg-success/10 text-success px-2 py-0.5 text-[10px]">
          Verified
        </span>
      </div>
    </div>
  );
}
