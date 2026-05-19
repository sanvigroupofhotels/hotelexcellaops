import { toPng, toBlob } from "html-to-image";
import { toast } from "sonner";
import type { QuoteRow } from "@/lib/quotes-api";
import { logWhatsApp } from "@/lib/quotes-api";

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
 * Share the quote image via native share (mobile), falling back to:
 * 1) Download image + open WhatsApp with text
 * 2) Plain text WhatsApp deep link
 */
export async function shareQuoteImage(node: HTMLElement, q: QuoteRow) {
  const caption = whatsappCaption(q);
  const filename = `${q.reference_code}.png`;

  try {
    const blob = await nodeToBlob(node);
    if (!blob) throw new Error("Image generation failed");
    const file = new File([blob], filename, { type: "image/png" });

    // Best path: native share with file (Android Chrome → WhatsApp).
    const nav = navigator as any;
    if (nav.canShare && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], text: caption, title: "Hotel Excella Quote" });
      await logWhatsApp(q.id);
      return;
    }

    // Fallback: download image + open WhatsApp with caption
    const url = URL.createObjectURL(blob);
    downloadDataUrl(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    const phone = q.phone.replace(/[^0-9]/g, "");
    const link = `https://wa.me/${phone}?text=${encodeURIComponent(caption)}`;
    window.open(link, "_blank", "noopener");
    await logWhatsApp(q.id);
    toast.success("Image saved — attach it in the WhatsApp window");
  } catch (e: any) {
    if (e?.name === "AbortError") return; // user cancelled
    toast.error(e?.message ?? "Could not share quote");
  }
}

/** Download the quote image as PNG (Save Image action). */
export async function downloadQuoteImage(node: HTMLElement, q: QuoteRow) {
  try {
    const dataUrl = await nodeToPng(node);
    downloadDataUrl(dataUrl, `${q.reference_code}.png`);
    toast.success("Image downloaded");
  } catch (e: any) {
    toast.error(e?.message ?? "Failed to export image");
  }
}
