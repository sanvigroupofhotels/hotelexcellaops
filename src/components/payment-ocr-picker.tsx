import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Camera, Upload, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { extractPaymentDetails } from "@/lib/payment-ocr.functions";

export const PAYMENT_SCREENSHOTS_BUCKET = "payment-screenshots";

export interface ExtractedPayment {
  amount?: number;
  txn_id?: string;
  date?: string;
  time?: string;
  app?: string;
  payer_name?: string;
  merchant_name?: string;
  raw_text?: string;
}

interface Props {
  /** Optional booking id used as folder prefix (otherwise "_orphan"). */
  bookingId?: string;
  onExtracted: (result: {
    extracted: ExtractedPayment;
    raw_text: string;
    image_path: string;
  }) => void;
}

/**
 * Three-way picker:
 *  - Manual Entry      → caller proceeds with the form as today
 *  - Upload Screenshot → file picker, image only
 *  - Capture Photo     → device camera
 *
 * After upload/capture we ship the image to payment-screenshots bucket and
 * call the OCR server function. Returned values are passed up via onExtracted
 * so the caller can pre-fill the Add Payment form. NEVER auto-saves.
 */
export function PaymentOcrPicker({ bookingId, onExtracted }: Props) {
  const extractFn = useServerFn(extractPaymentDetails);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    setBusy(true);
    try {
      const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || "jpg").toLowerCase();
      const path = `${bookingId ?? "_orphan"}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage
        .from(PAYMENT_SCREENSHOTS_BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || "image/jpeg" });
      if (up.error) throw up.error;

      // Local preview for the user.
      const localUrl = URL.createObjectURL(file);
      setPreview({ name: file.name, url: localUrl });

      const result = await extractFn({ data: { imagePath: path } });
      onExtracted(result as any);
      toast.success("Details extracted — please verify before saving");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not extract payment details");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-card/40 p-3 space-y-2">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-gold" /> Pre-fill from screenshot (optional)
      </div>
      <div className="flex flex-wrap gap-2">
        <label className={`inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40 ${busy ? "opacity-50 pointer-events-none" : ""}`}>
          <Upload className="h-3.5 w-3.5" /> Upload Screenshot
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className={`inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40 ${busy ? "opacity-50 pointer-events-none" : ""}`}>
          <Camera className="h-3.5 w-3.5" /> Capture Photo
          <input type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
        </label>
        {busy && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Extracting…
          </span>
        )}
      </div>
      {preview && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <img src={preview.url} alt="screenshot" className="h-10 w-10 object-cover rounded border border-border" />
          <span className="truncate flex-1">{preview.name}</span>
          <button type="button" onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}
            className="p-1 rounded hover:bg-accent" aria-label="Clear preview">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        Auto-fill only — staff must verify amount, UTR and time before saving.
      </p>
    </div>
  );
}
