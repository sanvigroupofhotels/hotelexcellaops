/**
 * A4 single-page PDF renderer for the shared invoice document model.
 *
 * This is the ONLY PDF implementation in HEOS — Invoice and Proforma Invoice
 * both render through `renderInvoicePdf(model)`; the model's `kind` flag drives
 * the title and terms. Download saves this file directly (never window.print),
 * and Print prints this very same PDF so screen, download and print never drift.
 *
 * Fitting strategy (layout-first, not "shrink the font"):
 *   1. Rooms of identical type/rate/dates are already folded upstream.
 *   2. Row leading steps down through a small, still-readable range.
 *   3. Payment rows collapse to per-mode summaries, then to a single Total Paid.
 *   4. Long charge lists fold their tail into one "Other charges (N)" row.
 * The signature block sits at a reserved, fixed position at the bottom of the
 * page, so it can never be pushed to a second page.
 */
import { jsPDF } from "jspdf";
import type { InvoiceDocModel, InvoicePaymentLine, InvoiceChargeLine } from "@/lib/invoice-document";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 34;
const GOLD: [number, number, number] = [176, 141, 66];
const INK: [number, number, number] = [26, 26, 26];
const MUTED: [number, number, number] = [110, 110, 110];
const RULE: [number, number, number] = [214, 214, 214];

/** Reserved band at the bottom of the page for footer + signature. */
const SIGNATURE_BAND_H = 96;

const inr = (n: number) => `Rs. ${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const fmtDate = (s: string) => {
  const d = new Date(s + (s?.length === 10 ? "T00:00:00" : ""));
  return isNaN(d.getTime()) ? String(s ?? "") : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const fmtDateTime = (s: string) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s ?? "") : d.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
};

type Row =
  | { t: "section"; label: string }
  | { t: "row"; label: string; sub?: string; right: string; bold?: boolean; muted?: boolean }
  | { t: "rule" };

/** Collapse payments by mode — keeps the financial total identical. */
export function summarisePaymentsByMode(payments: InvoicePaymentLine[]): InvoicePaymentLine[] {
  const byMode = new Map<string, number>();
  for (const p of payments) byMode.set(p.mode, (byMode.get(p.mode) ?? 0) + p.amount);
  return [...byMode.entries()].map(([mode, amount]) => ({ date: "", mode, amount }));
}

/** Fold the tail of a long charge list into one aggregate row. */
export function foldChargeTail(lines: InvoiceChargeLine[], keep: number): InvoiceChargeLine[] {
  if (lines.length <= keep) return lines;
  const head = lines.slice(0, keep);
  const tail = lines.slice(keep);
  head.push({
    label: `Other charges (${tail.length} items)`,
    room: "",
    qty: 1,
    amount: tail.reduce((s, c) => s + c.amount, 0),
    itemId: null,
  });
  return head;
}

/** Build the ordered body rows for a given density variant. */
function buildRows(m: InvoiceDocModel, variant: { payments: "full" | "byMode" | "total"; chargeKeep: number }): Row[] {
  const rows: Row[] = [];
  rows.push({ t: "section", label: "Accommodation" });
  for (const r of m.roomLines) {
    rows.push({
      t: "row",
      label: `${r.qty > 1 ? `${r.qty} × ` : ""}${r.label}${r.nights ? `  ·  ${r.nights}N` : ""}${r.rate ? `  ·  ${inr(r.rate)}/night` : ""}`,
      sub: r.detail || undefined,
      right: inr(r.amount),
    });
  }
  if (m.extraLines.length) {
    rows.push({ t: "section", label: "Additional Stay Charges" });
    for (const e of m.extraLines) rows.push({ t: "row", label: e.label, right: inr(e.value), muted: true });
  }
  const charges = foldChargeTail(m.chargeLines, variant.chargeKeep);
  if (charges.length) {
    rows.push({ t: "section", label: "In-House Charges (tax incl.)" });
    for (const c of charges) {
      rows.push({
        t: "row",
        label: `${c.label}${c.qty !== 1 ? ` × ${c.qty}` : ""}${c.room ? `  —  ${c.room}` : ""}`,
        right: inr(c.amount),
        muted: true,
      });
    }
  }

  rows.push({ t: "rule" });
  rows.push({ t: "row", label: "Subtotal", right: inr(m.totals.subtotal) });
  if (m.totals.discount > 0) rows.push({ t: "row", label: "Discount", right: `- ${inr(m.totals.discount)}` });
  rows.push({ t: "row", label: "Taxable Amount", right: inr(m.totals.taxable), muted: true });
  rows.push({
    t: "row",
    label: `Tax${m.totals.taxRate > 0 ? ` (${Math.round(m.totals.taxRate * 100)}%)` : ""}`,
    right: inr(m.totals.taxes),
    muted: true,
  });
  rows.push({ t: "row", label: m.isFinal ? "Total Invoice Amount" : "Total Payable", right: inr(m.totals.total), bold: true });

  rows.push({ t: "section", label: m.isFinal ? "Payment Summary" : "Payments Received" });
  if (!m.payments.length) {
    rows.push({ t: "row", label: "No payments recorded yet.", right: inr(0), muted: true });
  } else if (variant.payments === "total") {
    rows.push({ t: "row", label: `Total Paid (${m.payments.length} payments)`, right: inr(m.paymentsTotal) });
  } else {
    const list = variant.payments === "byMode" ? summarisePaymentsByMode(m.payments) : m.payments;
    for (const p of list) {
      rows.push({
        t: "row",
        label: p.date ? `${fmtDateTime(p.date)}  ·  ${p.mode}` : p.mode,
        right: inr(p.amount),
        muted: true,
      });
    }
    rows.push({ t: "row", label: "Total Paid", right: inr(m.paymentsTotal) });
  }

  rows.push({ t: "rule" });
  rows.push({ t: "row", label: "Amount Paid", right: inr(m.totals.paid) });
  rows.push({
    t: "row",
    label: m.totals.isCredit ? "Guest Credit" : m.isFinal ? "Outstanding Balance" : "Balance Due",
    right: inr(Math.abs(m.totals.balance)),
    bold: true,
  });
  return rows;
}

function rowHeight(r: Row, leading: number) {
  if (r.t === "rule") return leading * 0.55;
  if (r.t === "section") return leading * 1.5;
  return r.sub ? leading + 8 : leading;
}

/** Header + guest/stay meta block. Returns the y where the body may start. */
function drawHead(doc: jsPDF, m: InvoiceDocModel) {
  let y = M + 4;
  // Brand mark
  doc.setFillColor(...GOLD);
  doc.roundedRect(M, y - 2, 30, 30, 4, 4, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold").setFontSize(16);
  doc.text("H", M + 11, y + 18);

  doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(13);
  doc.text(m.hotel.name, M + 38, y + 8);
  doc.setFont("helvetica", "normal").setFontSize(7.4).setTextColor(...MUTED);
  doc.text(`${m.hotel.address}  ·  ${m.hotel.phone}`, M + 38, y + 18);
  doc.text(`${m.hotel.email}  ·  GSTIN: ${m.hotel.gstin}`, M + 38, y + 27);

  // Title block (right)
  doc.setTextColor(...GOLD).setFont("helvetica", "bold").setFontSize(m.isFinal ? 18 : 15);
  doc.text(m.kind, PAGE_W - M, y + 10, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(7.6).setTextColor(...MUTED);
  doc.text(`No: ${m.number}`, PAGE_W - M, y + 21, { align: "right" });
  doc.text(`Date: ${fmtDate(m.issuedAt)}`, PAGE_W - M, y + 30, { align: "right" });

  y += 40;
  doc.setDrawColor(...RULE).setLineWidth(0.6);
  doc.line(M, y, PAGE_W - M, y);
  y += 13;

  // Guest / booking / stay — two compact columns, no repeated room info.
  const colR = M + (PAGE_W - 2 * M) / 2 + 6;
  const label = (t: string, x: number, yy: number) => {
    doc.setFont("helvetica", "bold").setFontSize(6.8).setTextColor(...GOLD);
    doc.text(t.toUpperCase(), x, yy);
  };
  const line = (t: string, x: number, yy: number, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(8.4).setTextColor(...INK);
    doc.text(t, x, yy);
  };
  label("Billed To", M, y);
  label("Stay Details", colR, y);
  let ly = y + 11;
  line(m.guest.name, M, ly, true);
  line(
    `${fmtDate(m.stay.checkIn)}  →  ${fmtDate(m.stay.checkOut)}   (${m.stay.nights}N)`,
    colR, ly, true,
  );
  ly += 10;
  const contact = [m.guest.phone, m.guest.email].filter(Boolean).join("  ·  ");
  if (contact) line(contact, M, ly);
  const times = [m.stay.checkInTime && `In ${m.stay.checkInTime}`, m.stay.checkOutTime && `Out ${m.stay.checkOutTime}`]
    .filter(Boolean).join("  ·  ");
  const guests = `${m.stay.adults} Adult${m.stay.adults === 1 ? "" : "s"}${m.stay.children ? ` + ${m.stay.children} Child${m.stay.children === 1 ? "" : "ren"}` : ""}`;
  line([guests, times].filter(Boolean).join("   ·   "), colR, ly);
  ly += 10;
  doc.setFont("helvetica", "normal").setFontSize(7.6).setTextColor(...MUTED);
  doc.text(`Booking Ref: ${m.number.replace(/^(INV|PI)-/, "")}`, M, ly);
  const roomsSummary = m.roomLines.map((r) => `${r.qty} × ${r.label}`).join(", ");
  doc.text(roomsSummary.length > 70 ? `${roomsSummary.slice(0, 67)}...` : roomsSummary, colR, ly);

  ly += 8;
  doc.setDrawColor(...RULE);
  doc.line(M, ly, PAGE_W - M, ly);
  return ly + 12;
}

function drawSignatureBand(doc: jsPDF, m: InvoiceDocModel) {
  const top = PAGE_H - M - SIGNATURE_BAND_H;
  doc.setDrawColor(...RULE).setLineWidth(0.6);
  doc.line(M, top, PAGE_W - M, top);

  // Footer / terms (left)
  doc.setFont("helvetica", "normal").setFontSize(7.2).setTextColor(...MUTED);
  const footer = doc.splitTextToSize(m.footer, (PAGE_W - 2 * M) * 0.55);
  doc.text(footer.slice(0, 4), M, top + 14);

  // Signature (right) — reserved space, always on this page.
  const rightX = PAGE_W - M;
  const sigBaseline = top + 56;
  if (m.signature.url) {
    try {
      doc.addImage(m.signature.url, "PNG", rightX - 130, top + 8, 130, 44, undefined, "FAST");
    } catch { /* unreadable signature image — fall back to the ruled line */ }
  }
  doc.setDrawColor(150, 150, 150).setLineWidth(0.5);
  doc.line(rightX - 130, sigBaseline, rightX, sigBaseline);
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...INK);
  doc.text(m.signature.designation, rightX, sigBaseline + 12, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(7.2).setTextColor(...MUTED);
  doc.text(m.hotel.name, rightX, sigBaseline + 21, { align: "right" });
  doc.text(
    `${m.hotel.website}  ·  This is a computer generated document.`,
    M, PAGE_H - M + 2,
  );
}

function drawRows(doc: jsPDF, rows: Row[], startY: number, leading: number) {
  let y = startY;
  const rightX = PAGE_W - M;
  for (const r of rows) {
    if (r.t === "rule") {
      doc.setDrawColor(...RULE).setLineWidth(0.5);
      doc.line(M, y - leading * 0.35, rightX, y - leading * 0.35);
      y += rowHeight(r, leading);
      continue;
    }
    if (r.t === "section") {
      doc.setFont("helvetica", "bold").setFontSize(6.8).setTextColor(...GOLD);
      doc.text(r.label.toUpperCase(), M, y + leading * 0.35);
      y += rowHeight(r, leading);
      continue;
    }
    const size = r.bold ? 10 : 8.6;
    doc.setFont("helvetica", r.bold ? "bold" : "normal").setFontSize(size);
    doc.setTextColor(...(r.muted ? MUTED : INK));
    const labelMax = (PAGE_W - 2 * M) * 0.68;
    let label = r.label;
    while (doc.getTextWidth(label) > labelMax && label.length > 8) label = `${label.slice(0, -5)}...`;
    doc.text(label, M, y);
    if (r.bold) doc.setTextColor(...GOLD);
    doc.text(r.right, rightX, y, { align: "right" });
    if (r.sub) {
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...MUTED);
      doc.text(r.sub, M + 8, y + 8);
    }
    y += rowHeight(r, leading);
  }
  return y;
}

/**
 * Render the invoice/proforma as a single-page A4 jsPDF document.
 * Guaranteed one page: the body is fitted between the header and the reserved
 * signature band before anything is drawn.
 */
export function renderInvoicePdf(m: InvoiceDocModel): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const bodyTop = drawHead(doc, m);
  const bodyBottom = PAGE_H - M - SIGNATURE_BAND_H - 10;
  const available = bodyBottom - bodyTop;

  const variants: { payments: "full" | "byMode" | "total"; chargeKeep: number }[] = [
    { payments: "full", chargeKeep: 40 },
    { payments: "byMode", chargeKeep: 40 },
    { payments: "byMode", chargeKeep: 14 },
    { payments: "total", chargeKeep: 10 },
    { payments: "total", chargeKeep: 6 },
  ];
  const leadings = [13, 12.2, 11.4, 10.6, 10];

  let chosen = { rows: buildRows(m, variants[0]!), leading: leadings[0]! };
  let fits = false;
  outer: for (const v of variants) {
    const rows = buildRows(m, v);
    for (const leading of leadings) {
      const h = rows.reduce((s, r) => s + rowHeight(r, leading), 0);
      if (h <= available) { chosen = { rows, leading }; fits = true; break outer; }
    }
  }
  if (!fits) {
    // Last resort: tightest variant at the smallest leading — still one page.
    chosen = { rows: buildRows(m, variants[variants.length - 1]!), leading: leadings[leadings.length - 1]! };
  }

  drawRows(doc, chosen.rows, bodyTop + chosen.leading, chosen.leading);
  drawSignatureBand(doc, m);
  return doc;
}

export function invoiceFileName(m: InvoiceDocModel) {
  return `${m.number}.pdf`;
}

/** Number of pages in the rendered PDF — used by regression tests. */
export function invoicePdfPageCount(m: InvoiceDocModel) {
  return renderInvoicePdf(m).getNumberOfPages();
}

/** Download the PDF directly. Never invokes window.print(). */
export function downloadInvoicePdf(m: InvoiceDocModel) {
  const doc = renderInvoicePdf(m);
  doc.save(invoiceFileName(m));
}

export function invoicePdfBlob(m: InvoiceDocModel): Blob {
  return renderInvoicePdf(m).output("blob");
}

/** Print the exact same PDF through a hidden iframe (separate from Download). */
export function printInvoicePdf(m: InvoiceDocModel) {
  const url = URL.createObjectURL(invoicePdfBlob(m));
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, "_blank");
    }
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  document.body.appendChild(frame);
}
