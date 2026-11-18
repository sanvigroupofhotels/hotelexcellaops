/** The single A4 renderer for downloads and printing across all invoice surfaces. */
import { jsPDF } from "jspdf";
import { invoiceMoney, type InvoiceDocModel, type InvoicePaymentLine, type InvoiceChargeLine, type InvoiceTableLine } from "@/lib/invoice-document";

const W = 595.28, H = 841.89, M = 32;
const inr = (n: number) => `INR ${invoiceMoney(n)}`;
const fmtDate = (s: string) => {
  const d = new Date(s + (s.length === 10 ? "T00:00:00" : ""));
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" });
};
const clean = (s: string) => s.replace(/₹/g, "INR ").replace(/[–—→]/g, "-").replace(/×/g, "x").replace(/−/g, "-").replace(/[^\x20-\x7e\n]/g, " ");

/** CSS print tokens drive the browser; grayscale fallbacks allow server/test rendering. */
function color(role: string, fallback: number): [number, number, number] {
  if (typeof document !== "undefined" && typeof getComputedStyle === "function") {
    const parts = getComputedStyle(document.documentElement).getPropertyValue(`--invoice-pdf-${role}`).split(",").map(Number);
    const [r, g, b] = parts;
    if (parts.length === 3 && r !== undefined && g !== undefined && b !== undefined && parts.every(Number.isFinite)) return [r, g, b];
  }
  return [fallback, fallback, fallback];
}
export function summarisePaymentsByMode(payments: InvoicePaymentLine[]): InvoicePaymentLine[] {
  const modes = new Map<string, number>();
  for (const p of payments) modes.set(p.mode, (modes.get(p.mode) ?? 0) + p.amount);
  return [...modes].map(([mode, amount]) => ({ date: "", mode, amount }));
}
export function foldChargeTail(lines: InvoiceChargeLine[], keep: number): InvoiceChargeLine[] {
  if (lines.length <= keep) return lines;
  return [...lines.slice(0, keep), { label: `Other charges (${lines.length - keep} items)`, room: "", qty: 1, amount: lines.slice(keep).reduce((s, c) => s + c.amount, 0), itemId: null }];
}

export function renderInvoicePdf(m: InvoiceDocModel): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  doc.setProperties({ title: `${m.kind} ${m.number}`, subject: "Accommodation invoice", author: m.hotel.legal_name || m.hotel.name });
  const ink = color("ink", 37), muted = color("muted", 102), rule = color("rule", 213), band = color("band", 241);
  const text = (s: string, x: number, y: number, size = 9, bold = false, align: "left" | "right" = "left") => {
    doc.setTextColor(...ink).setFont("helvetica", bold ? "bold" : "normal").setFontSize(size);
    doc.text(clean(s), x, y, { align });
  };
  const wrapped = (s: string, width: number, size = 9) => {
    doc.setFont("helvetica", "normal").setFontSize(size);
    return doc.splitTextToSize(clean(s), width) as string[];
  };
  const ruleAt = (y: number) => { doc.setDrawColor(...rule).setLineWidth(0.55); doc.line(M, y, W - M, y); };
  const image = (url: string | null, x: number, y: number, w: number, h: number) => {
    if (!url?.startsWith("data:image/")) return;
    try {
      const props = doc.getImageProperties(url);
      const factor = Math.min(w / props.width, h / props.height);
      doc.addImage(url, props.fileType, x + (w - props.width * factor) / 2, y + (h - props.height * factor) / 2, props.width * factor, props.height * factor);
    } catch { /* Keep the authorized-signatory line if an image is unreadable. */ }
  };
  image(m.hotel.logo_url, M, 32, 72, 52);
  const hx = m.hotel.logo_url ? M + 84 : M;
  const entityWidth = W - M - hx;
  const entity = wrapped(m.hotel.legal_name || m.hotel.name, entityWidth, 15);
  let y = 45;
  for (const line of entity) { text(line, hx, y, 15, true); y += 17; }
  if (m.hotel.legal_name && m.hotel.name) { text(`(Unit: ${m.hotel.name})`, hx, y, 10); y += 14; }
  for (const line of wrapped(m.hotel.address, entityWidth, 8.5)) { text(line, hx, y, 8.5); y += 11; }
  text([m.hotel.gstin && `GSTIN: ${m.hotel.gstin}`, m.hotel.phone && `Ph: ${m.hotel.phone}`].filter(Boolean).join("   |   "), hx, y, 8.5); y += 12;
  for (const line of wrapped([m.hotel.email, m.hotel.website].filter(Boolean).join("   |   "), entityWidth, 8)) { text(line, hx, y, 8); y += 10; }
  y = Math.max(y + 12, 118);
  ruleAt(y); y += 22;
  text(m.kind, W - M, y, 21, true, "right");
  text(`Invoice No: ${m.number}`, M, y, 9, true); y += 15;
  text(`Invoice Date: ${fmtDate(m.issuedAt)}`, M, y, 9);
  text(`Booking Ref: ${m.number.replace(/^(INV|PI)-/, "")}`, W - M, y, 9, false, "right"); y += 16;
  ruleAt(y); y += 16;
  text("BILL TO", M, y, 8, true);
  text("STAY DETAILS", 340, y, 8, true); y += 14;
  const billLines = [m.guest.name, m.guest.company, m.guest.address, m.guest.gstin && `GSTIN: ${m.guest.gstin}`, [m.guest.phone, m.guest.email].filter(Boolean).join(" | ")].filter((v): v is string => !!v).flatMap((v) => wrapped(v, 286, 9));
  for (let i = 0; i < billLines.length; i++) text(billLines[i] ?? "", M, y + i * 12, 9, i === 0);
  text(`Check In: ${fmtDate(m.stay.checkIn)}`, 340, y, 9);
  text(`Check Out: ${fmtDate(m.stay.checkOut)}`, 340, y + 13, 9);
  text(`${m.stay.nights} night(s) | ${m.stay.adults} adult(s)${m.stay.children ? ` | ${m.stay.children} child(ren)` : ""}`, 340, y + 26, 8);
  text(`In ${m.stay.checkInTime ?? ""} | Out ${m.stay.checkOutTime ?? ""}`, 340, y + 39, 8);
  y += Math.max(56, billLines.length * 12 + 10);

  const cols = [M, M + 22, M + 187, M + 241, M + 295, M + 339, M + 384, M + 453, W - M];
  const header = () => {
    doc.setFillColor(...band).setDrawColor(...rule); doc.rect(M, y, W - M * 2, 28, "FD");
    ["#", "Description / SAC", "Check In", "Check Out", "Room(s)", "Days / Qty", "Rate", "Amount"].forEach((s, i) => text(s, (cols[i] ?? M) + 4, y + 17, 7, true));
    y += 28;
  };
  const newPage = () => {
    doc.addPage(); y = M; text(`${m.kind} - ${m.number} (continued)`, M, y, 10, true); y += 16; header();
  };
  let rows = m.tableLines;
  const makeLines = (r: InvoiceTableLine) => wrapped(`${r.description}${r.sac ? `\nSAC: ${r.sac}` : ""}`, 155, 7.8);
  const rowHeight = (r: InvoiceTableLine) => Math.max(30, Math.max(makeLines(r).length * 10, wrapped(r.rooms || "-", 36, 7).length * 9) + 10);
  // Keep normal invoices single-page, preserving the original aggregate-tail convention for long charge lists.
  if (rows.reduce((s, r) => s + rowHeight(r), 0) > H - y - 300 && m.chargeLines.length > 4) {
    const folded = foldChargeTail(m.chargeLines, 3);
    const head = m.tableLines.slice(0, m.roomLines.length + m.extraLines.length);
    const adjustment = m.tableLines.slice(m.roomLines.length + m.extraLines.length + m.chargeLines.length);
    rows = [...head, ...folded.map((c) => ({ description: c.label, sac: "", checkIn: "", checkOut: "", rooms: c.room, qty: c.qty, unit: "Units", rate: c.amount / c.qty, amount: c.amount })), ...adjustment];
  }
  header();
  rows.forEach((r, index) => {
    const lines = makeLines(r);
    const height = rowHeight(r);
    if (y + height > H - M - 18) newPage();
    doc.setDrawColor(...rule).setLineWidth(0.4); doc.rect(M, y, W - M * 2, height);
    for (const x of cols.slice(1, -1)) doc.line(x, y, x, y + height);
    text(String(index + 1), M + 5, y + 13, 7.5);
    lines.forEach((line, j) => text(line, M + 27, y + 13 + j * 10, 7.8));
    text(r.checkIn ? fmtDate(r.checkIn) : "-", M + 191, y + 13, 7);
    text(r.checkOut ? fmtDate(r.checkOut) : "-", M + 245, y + 13, 7);
    wrapped(r.rooms || "-", 36, 7).forEach((line, j) => text(line, M + 299, y + 13 + j * 9, 7));
    text(String(r.qty), M + 374, y + 13, 7.5, false, "right");
    text(r.unit, M + 343, y + 24, 6);
    text(invoiceMoney(r.rate), M + 449, y + 13, 7.5, false, "right");
    text(invoiceMoney(r.amount), W - M - 5, y + 13, 8, true, "right");
    y += height;
  });
  if (y + 270 > H - M) { doc.addPage(); y = M; text(`${m.number} - Settlement`, M, y, 11, true); y += 18; }
  y += 15;
  const totalsTop = y;
  text("TOTAL IN WORDS", M, y, 8, true);
  wrapped(m.amountInWords, 280, 9).forEach((line, i) => text(line, M, y + 15 + i * 12, 9));
  text("NOTES", M, y + 64, 8, true);
  const notes = `${!m.isFinal ? "This proforma is not a tax invoice. Final invoice is issued after checkout. " : ""}${m.footer}`;
  wrapped(notes, 275, 8).forEach((line, i) => text(line, M, y + 78 + i * 11, 8));
  let ty = y;
  const totalLine = (label: string, amount: number, bold = false) => {
    text(label, 342, ty, 8.5, bold); text(inr(amount), W - M, ty, 9, bold, "right"); ty += 17;
  };
  totalLine("Sub Total", m.totals.subtotal);
  if (m.totals.discount > 0) totalLine("Discount", -m.totals.discount);
  totalLine("Taxable Amount", m.totals.taxable);
  m.taxLines.forEach((t) => totalLine(`${t.label} (${t.rate}%)`, t.amount));
  totalLine("Total", m.totals.total, true);
  totalLine("Payment Made", m.totals.paid);
  totalLine(m.totals.isCredit ? "Guest Credit" : "Balance Due", Math.abs(m.totals.balance), true);
  const paymentTop = Math.max(totalsTop + 120, ty + 8);
  text("PAYMENTS RECEIVED", M, paymentTop, 8, true);
  const payments = m.payments.length > 3 ? summarisePaymentsByMode(m.payments) : m.payments;
  let py = paymentTop + 14;
  if (!payments.length) text("No payments recorded.", M, py, 8);
  for (const p of payments) { text(`${p.date ? `${fmtDate(p.date)} | ` : ""}${p.mode}: ${inr(p.amount)}`, M, py, 8); py += 11; }
  const sigY = Math.min(H - M - 64, paymentTop + 12);
  image(m.signature.url, W - M - 148, sigY - 8, 148, 42);
  doc.setDrawColor(...rule); doc.line(W - M - 148, sigY + 38, W - M, sigY + 38);
  wrapped(m.signature.designation, 160, 8).forEach((line, i) => text(line, W - M, sigY + 50 + i * 10, 8, true, "right"));
  text(m.hotel.legal_name || m.hotel.name, W - M, sigY + 70, 7.5, false, "right");
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page); doc.setTextColor(...muted).setFontSize(7);
    doc.text(`All amounts in INR | ${m.number}`, M, H - 18);
    doc.text(`Page ${page} of ${doc.getNumberOfPages()}`, W - M, H - 18, { align: "right" });
  }
  return doc;
}

/** Resolve configured images before PDF creation, preserving their original pixels. */
export async function prepareInvoicePdf(m: InvoiceDocModel): Promise<InvoiceDocModel> {
  const convert = async (url: string | null) => {
    if (!url || url.startsWith("data:image/png") || url.startsWith("data:image/jpeg")) return url;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not load invoice image. Please retry.");
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close(); throw new Error("Could not prepare invoice image."); }
    ctx.drawImage(bitmap, 0, 0); bitmap.close(); return canvas.toDataURL("image/png");
  };
  const [logo, signature] = await Promise.all([convert(m.hotel.logo_url), convert(m.signature.url)]);
  return { ...m, hotel: { ...m.hotel, logo_url: logo ?? "" }, signature: { ...m.signature, url: signature } };
}
export const invoiceFileName = (m: InvoiceDocModel) => `${m.number}.pdf`;
export const invoicePdfPageCount = (m: InvoiceDocModel) => renderInvoicePdf(m).getNumberOfPages();
export function downloadInvoicePdf(m: InvoiceDocModel) { renderInvoicePdf(m).save(invoiceFileName(m)); }
export const invoicePdfBlob = (m: InvoiceDocModel): Blob => renderInvoicePdf(m).output("blob");
export function printInvoicePdf(m: InvoiceDocModel) {
  const url = URL.createObjectURL(invoicePdfBlob(m));
  const frame = document.createElement("iframe");
  frame.hidden = true; frame.src = url;
  frame.onload = () => {
    try { frame.contentWindow?.focus(); frame.contentWindow?.print(); } catch { window.open(url, "_blank"); }
    setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60_000);
  };
  document.body.appendChild(frame);
}
