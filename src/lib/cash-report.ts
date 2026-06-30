import type { CashTxRow } from "./cash-api";

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Single source of truth for the WhatsApp-friendly "Today's Cash Report"
 * shared between CashBook and Reporting.
 */
export function buildDailyCashReport(tx: CashTxRow[], day: Date, openingBalance: number) {
  const ymdKey = ymd(day);
  const dayTx = tx.filter((t) => t.active && ymd(new Date(t.occurred_at)) === ymdKey);
  const income = dayTx.filter((t) => t.kind === "collection");
  const expense = dayTx.filter((t) => t.kind === "expense");
  const totalIn = income.reduce((s, t) => s + Number(t.amount), 0);
  const totalOut = expense.reduce((s, t) => s + Number(t.amount), 0);
  const closing = openingBalance + totalIn - totalOut;
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const dateLabel = day.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const lines: string[] = [];
  lines.push(`Cash Report – ${dateLabel}`);
  lines.push("");
  lines.push(`Opening Balance:`);
  lines.push(fmt(openingBalance));
  lines.push("");
  lines.push("---");
  lines.push("");
  // Line label priority: guest_name → notes → description → type_name.
  const labelFor = (t: CashTxRow) => {
    const guest = (t.guest_name ?? "").trim();
    const notes = (t.notes ?? "").trim();
    const desc = (t.description ?? "").trim();
    return guest || notes || desc || t.type_name;
  };
  lines.push("Income Today:");
  if (income.length === 0) lines.push("(none)");
  else for (const t of income) lines.push(`${fmt(Number(t.amount))} - ${labelFor(t)}`);
  lines.push("");
  lines.push(`Total Income:`);
  lines.push(fmt(totalIn));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("Expenses Today:");
  if (expense.length === 0) lines.push("(none)");
  else for (const t of expense) lines.push(`${fmt(Number(t.amount))} - ${labelFor(t)}`);
  lines.push("");
  lines.push(`Total Expenses:`);
  lines.push(fmt(totalOut));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`Current Cash Balance:`);
  lines.push(fmt(closing));
  return lines.join("\n");
}

/** Compute opening balance for a given day from full tx list. */
export function computeOpeningBalance(tx: CashTxRow[], day: Date): number {
  const ymdKey = ymd(day);
  let opening = 0;
  for (const t of tx) {
    if (!t.active) continue;
    if (ymd(new Date(t.occurred_at)) >= ymdKey) continue;
    opening += t.kind === "collection" ? Number(t.amount) : -Number(t.amount);
  }
  return opening;
}

// ─────────────────────────────────────────────────────────────────────
// Printable / PDF Cash Report (browser print → Save as PDF)
// ─────────────────────────────────────────────────────────────────────
//
// Single source of truth for the printed report. Used by Cash Reports modal
// and any future "Daily Closing Sheet" widget. PDF generation goes through
// the browser's native print dialog — zero new dependencies, consistent
// rendering across desktop + mobile.

export interface PrintCashReportInput {
  rows: CashTxRow[];                              // filtered transactions
  grouped?: { key: string; collected: number; spent: number; net: number; count: number }[] | null;
  groupLabel?: "Date" | "Category" | "Entered By" | null;
  totals: { collected: number; spent: number; balance: number; ownerPaid: number };
  opening?: number | null;                        // null/undefined when range="all"
  periodLabel: string;
  filters: { kind?: string; category?: string; staff?: string };
  showInactive: boolean;
  hotelName?: string;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function buildPrintableCashReportHTML(input: PrintCashReportInput): string {
  const {
    rows, grouped, groupLabel, totals, opening, periodLabel,
    filters, showInactive, hotelName = "Hotel Excella",
  } = input;
  const printedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const filterChips = [
    filters.kind ? `Type: ${filters.kind === "collection" ? "Collections" : "Expenses"}` : null,
    filters.category ? `Category: ${filters.category}` : null,
    filters.staff ? `Entered By: ${filters.staff}` : null,
    showInactive ? "Including Inactive" : null,
  ].filter(Boolean).map((c) => `<span class="chip">${escapeHtml(c!)}</span>`).join("");

  const summaryHtml = `
    <div class="kpi-row">
      ${opening != null ? `<div class="kpi"><div class="kpi-lbl">Opening</div><div class="kpi-val">${inr(opening)}</div></div>` : ""}
      <div class="kpi"><div class="kpi-lbl">Total In</div><div class="kpi-val pos">${inr(totals.collected)}</div></div>
      <div class="kpi"><div class="kpi-lbl">Total Out</div><div class="kpi-val neg">${inr(totals.spent)}</div></div>
      <div class="kpi"><div class="kpi-lbl">Net</div><div class="kpi-val gold">${inr(totals.balance)}</div></div>
      ${opening != null ? `<div class="kpi"><div class="kpi-lbl">Closing</div><div class="kpi-val gold">${inr((opening ?? 0) + totals.balance)}</div></div>` : ""}
      <div class="kpi"><div class="kpi-lbl">Paid to Owner</div><div class="kpi-val">${inr(totals.ownerPaid)}</div></div>
    </div>`;

  let bodyHtml = "";
  if (grouped && grouped.length && groupLabel) {
    bodyHtml = `
      <table class="rep">
        <thead><tr>
          <th>${escapeHtml(groupLabel)}</th>
          <th class="r">Collected</th><th class="r">Spent</th><th class="r">Net</th><th class="r">Count</th>
        </tr></thead>
        <tbody>
          ${grouped.map((g) => `
            <tr>
              <td>${escapeHtml(g.key)}</td>
              <td class="r pos">${inr(g.collected)}</td>
              <td class="r neg">${inr(g.spent)}</td>
              <td class="r">${inr(g.net)}</td>
              <td class="r">${g.count}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } else if (rows.length) {
    bodyHtml = `
      <table class="rep">
        <thead><tr>
          <th>Date</th><th>Kind</th><th>Category</th><th>Other Type</th>
          <th>Guest</th><th>Staff</th><th class="r">Amount</th><th>Notes</th>
        </tr></thead>
        <tbody>
          ${rows.map((t) => `
            <tr class="${t.active ? "" : "inactive"}">
              <td>${escapeHtml(new Date(t.occurred_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }))}</td>
              <td>${t.kind === "collection" ? "In" : "Out"}</td>
              <td>${escapeHtml(t.type_name ?? "")}</td>
              <td>${escapeHtml(t.description ?? "—")}</td>
              <td>${escapeHtml(t.guest_name ?? "—")}</td>
              <td>${escapeHtml(t.staff_name ?? "—")}</td>
              <td class="r ${t.kind === "collection" ? "pos" : "neg"}">${inr(Number(t.amount))}</td>
              <td>${escapeHtml(t.notes ?? "—")}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } else {
    bodyHtml = `<div class="empty">No transactions for the selected filters.</div>`;
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>Cash Report — ${escapeHtml(periodLabel)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;margin:24px;font-size:12px;}
  .hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #C9972B;padding-bottom:10px;margin-bottom:14px;}
  .hdr h1{margin:0;font-size:20px;letter-spacing:0.5px;}
  .hdr .meta{font-size:11px;color:#555;text-align:right;}
  .period{font-size:13px;font-weight:600;margin-bottom:6px;}
  .chips{margin-bottom:10px;}
  .chip{display:inline-block;border:1px solid #d4af6c;background:#faf3e3;color:#7a5a18;border-radius:999px;padding:2px 10px;font-size:10px;margin-right:6px;}
  .kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:10px 0 14px;}
  .kpi{border:1px solid #e6e6e6;border-radius:6px;padding:8px 10px;background:#fafafa;}
  .kpi-lbl{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#777;}
  .kpi-val{font-size:14px;font-weight:600;margin-top:2px;}
  .pos{color:#0a7f3f;} .neg{color:#b1331a;} .gold{color:#9a7218;}
  table.rep{width:100%;border-collapse:collapse;font-size:11px;}
  table.rep th,table.rep td{border-bottom:1px solid #ececec;padding:6px 8px;text-align:left;vertical-align:top;}
  table.rep th{background:#f4ecd7;color:#5a430a;font-size:10px;text-transform:uppercase;letter-spacing:.5px;}
  table.rep td.r,table.rep th.r{text-align:right;}
  tr.inactive td{color:#999;text-decoration:line-through;}
  .empty{text-align:center;color:#888;padding:30px;border:1px dashed #ddd;border-radius:6px;}
  .ftr{margin-top:18px;border-top:1px solid #ddd;padding-top:8px;font-size:10px;color:#777;display:flex;justify-content:space-between;}
  @page{margin:14mm;}
  @media print{ .noprint{display:none!important;} body{margin:0;} }
</style></head>
<body>
  <div class="hdr">
    <div>
      <h1>${escapeHtml(hotelName)} — Cash Report</h1>
      <div class="period">${escapeHtml(periodLabel)}</div>
    </div>
    <div class="meta">Printed: ${escapeHtml(printedAt)}</div>
  </div>
  ${filterChips ? `<div class="chips">${filterChips}</div>` : ""}
  ${summaryHtml}
  ${bodyHtml}
  <div class="ftr"><span>Generated by HEOS</span><span>${escapeHtml(hotelName)}</span></div>
  <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),150));</script>
</body></html>`;
}

/** Open a print-ready window and trigger the browser's native print dialog. */
export function printCashReport(input: PrintCashReportInput): void {
  const html = buildPrintableCashReportHTML(input);
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) {
    throw new Error("Pop-up blocked — allow pop-ups for this site to print.");
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
