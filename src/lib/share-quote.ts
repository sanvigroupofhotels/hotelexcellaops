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

/** Download the quote image as PNG. Reliable across browsers (no Web Share dependency). */
export async function shareQuoteImage(node: HTMLElement, q: QuoteRow) {
  const filename = `${q.reference_code}.png`;
  try {
    const dataUrl = await nodeToPng(node);
    downloadDataUrl(dataUrl, filename);
    toast.success("Quote image saved");
  } catch (e: any) {
    toast.error(e?.message ?? "Failed to save image");
  }
}

/** Alias kept for any existing callers. */
export async function downloadQuoteImage(node: HTMLElement, q: QuoteRow) {
  return shareQuoteImage(node, q);
}
