import { toPng, toBlob } from "html-to-image";
import { toast } from "sonner";
import type { QuoteRow } from "@/lib/quotes-api";

/** Render a DOM node to a PNG data URL at 2x for retina-crisp images. */
export async function nodeToPng(node: HTMLElement): Promise<string> {
  return toPng(node, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: "#0b0b0f",
  });
}

export async function nodeToBlob(node: HTMLElement): Promise<Blob | null> {
  return toBlob(node, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: "#0b0b0f",
  });
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function whatsappCaption(q: QuoteRow) {
  return [
    `Hotel Excella — Quotation ${q.reference_code}`,
    `Dear ${q.guest_name},`,
    `${q.nights} Night${q.nights > 1 ? "s" : ""} · ${q.room_type} × ${q.rooms}`,
    `Total: ₹${Number(q.total).toLocaleString("en-IN")} (incl. taxes)`,
    `We look forward to hosting you.`,
  ].join("\n");
}

/**
 * Share the quote image. On mobile (Android/iOS) and supporting desktops,
 * this opens the native share sheet (WhatsApp, Gmail, Telegram, SMS, ...).
 * Falls back to a direct PNG download when Web Share with files isn't supported.
 */
export async function shareQuoteImage(node: HTMLElement, q: QuoteRow) {
  const filename = `${q.reference_code}.png`;
  try {
    const blob = await nodeToBlob(node);
    if (!blob) throw new Error("Could not render image");

    const file = new File([blob], filename, { type: "image/png" });
    const navAny = navigator as any;
    const canShareFile =
      typeof navAny.share === "function" &&
      typeof navAny.canShare === "function" &&
      navAny.canShare({ files: [file] });

    if (canShareFile) {
      try {
        await navAny.share({
          files: [file],
          title: `Hotel Excella · ${q.reference_code}`,
          text: whatsappCaption(q),
        });
        return;
      } catch (e: any) {
        // User cancelled — silent; any other error falls through to download.
        if (e?.name === "AbortError") return;
      }
    }

    // Fallback: download the PNG so the user can attach it manually.
    const dataUrl = URL.createObjectURL(blob);
    downloadDataUrl(dataUrl, filename);
    URL.revokeObjectURL(dataUrl);
    toast.success("Quote image saved — attach to your message");
  } catch (e: any) {
    toast.error(e?.message ?? "Failed to share image");
  }
}

/** Alias kept for any existing callers. */
export async function downloadQuoteImage(node: HTMLElement, q: QuoteRow) {
  return shareQuoteImage(node, q);
}
