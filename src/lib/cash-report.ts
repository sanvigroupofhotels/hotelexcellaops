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
  lines.push("Income Today:");
  if (income.length === 0) lines.push("(none)");
  else for (const t of income) lines.push(`${fmt(Number(t.amount))} - ${t.type_name}${t.description ? ` (${t.description})` : ""}`);
  lines.push("");
  lines.push(`Total Income:`);
  lines.push(fmt(totalIn));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("Expenses Today:");
  if (expense.length === 0) lines.push("(none)");
  else for (const t of expense) lines.push(`${fmt(Number(t.amount))} - ${t.type_name}${t.description ? ` (${t.description})` : ""}`);
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
