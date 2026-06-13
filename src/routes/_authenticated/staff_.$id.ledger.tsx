import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import {
  listStaffHr, listAdvances, listSalaryPayments,
  monthKey,
} from "@/lib/staff-hr-api";

export const Route = createFileRoute("/_authenticated/staff_/$id/ledger")({
  component: LedgerPage,
});

function inr(n: number) {
  const v = Number(n) || 0;
  return `${v < 0 ? "-" : ""}₹${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

interface Entry {
  date: string;
  label: string;
  credit: number;   // owed to staff (+)
  debit: number;    // paid / recovered (-)
  meta?: string;
}

function LedgerPage() {
  const { id } = useParams({ from: "/_authenticated/staff_/$id/ledger" });
  const [from, setFrom] = useState<string>(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 5); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const { data: staffList = [] } = useQuery({ queryKey: ["staff-hr"], queryFn: () => listStaffHr() });
  const staff = staffList.find((s) => s.id === id);

  const { data: advances = [] } = useQuery({ queryKey: ["advances", id, "all"], queryFn: () => listAdvances({ staff_id: id }) });
  const { data: payments = [] } = useQuery({ queryKey: ["salary-payments", id, "all"], queryFn: () => listSalaryPayments({ staff_id: id }) });

  // Build entries: salary generated (credit on month-end), advance taken (debit), salary paid (debit)
  const all: Entry[] = useMemo(() => {
    const out: Entry[] = [];
    for (const p of payments) {
      const [y, m] = p.month.split("-").map(Number);
      const last = new Date(y, m, 0).toISOString().slice(0, 10);
      out.push({
        date: last,
        label: `Salary Generated · ${p.month}`,
        credit: Number(p.gross) - Number(p.absent_deduction || 0) - Number(p.halfday_deduction || 0) - Number(p.other_deductions || 0),
        debit: 0,
        meta: `Gross ${inr(p.gross)} · Net ${inr(p.net)}`,
      });
      if (Number(p.advance_recovery) > 0) {
        out.push({ date: last, label: `Advance Recovered · ${p.month}`, credit: 0, debit: Number(p.advance_recovery) });
      }
      if (Number(p.paid_amount) > 0 && p.paid_at) {
        out.push({
          date: p.paid_at.slice(0, 10),
          label: `Salary Paid · ${p.month}`,
          credit: 0,
          debit: Number(p.paid_amount),
          meta: p.payment_mode ?? undefined,
        });
      }
    }
    for (const a of advances) {
      out.push({ date: a.advance_date, label: "Advance Taken", credit: 0, debit: Number(a.amount), meta: a.notes ?? undefined });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }, [payments, advances]);

  // Compute opening balance (sum of entries strictly before `from`)
  const opening = useMemo(() => {
    return all.filter((e) => e.date < from).reduce((s, e) => s + e.credit - e.debit, 0);
  }, [all, from]);

  // Entries within range with running balance
  const inRange = useMemo(() => {
    const rows = all.filter((e) => e.date >= from && e.date <= to);
    let bal = opening;
    return rows.map((e) => {
      bal += e.credit - e.debit;
      return { ...e, balance: bal };
    });
  }, [all, from, to, opening]);

  const closing = inRange.length > 0 ? inRange[inRange.length - 1].balance : opening;

  return (
    <div className="min-h-screen">
      <Topbar title={staff ? `${staff.name} · Ledger` : "Employee Ledger"} subtitle={staff?.designation ?? ""} />
      <main className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <Link to="/staff"><Button variant="ghost" size="sm"><ChevronLeft className="h-4 w-4" /> Back to Staff</Button></Link>
          <div className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-input/60 border border-border rounded-md px-2 py-1" /></label>
            <label className="flex items-center gap-1">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-input/60 border border-border rounded-md px-2 py-1" /></label>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <SummaryCard label="Opening Balance" value={opening} />
          <SummaryCard label="Total Credits" value={inRange.reduce((s, e) => s + e.credit, 0)} positive />
          <SummaryCard label="Total Debits" value={-inRange.reduce((s, e) => s + e.debit, 0)} positive={false} />
        </div>

        <div className="rounded-md border border-border overflow-x-auto bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-secondary/40">
                <TableCell className="text-xs">{new Date(from).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</TableCell>
                <TableCell className="font-medium">Opening Balance</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right font-semibold">{inr(opening)}</TableCell>
              </TableRow>
              {inRange.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No entries in range</TableCell></TableRow>
              )}
              {inRange.map((e, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-xs">{new Date(e.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</TableCell>
                  <TableCell>
                    <div className="text-sm">{e.label}</div>
                    {e.meta && <div className="text-[10px] text-muted-foreground">{e.meta}</div>}
                  </TableCell>
                  <TableCell className="text-right text-emerald-400">{e.credit > 0 ? `+${inr(e.credit)}` : ""}</TableCell>
                  <TableCell className="text-right text-red-400">{e.debit > 0 ? `-${inr(e.debit)}` : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(e.balance)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-secondary/40">
                <TableCell className="text-xs">{new Date(to).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</TableCell>
                <TableCell className="font-medium">Closing Balance</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right font-semibold gold-text-gradient">{inr(closing)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </main>
    </div>
  );
}

function SummaryCard({ label, value, positive }: { label: string; value: number; positive?: boolean }) {
  return (
    <div className="luxe-card rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-display text-xl ${positive === true ? "text-emerald-400" : positive === false ? "text-red-400" : "text-foreground"}`}>
        {value < 0 ? "-" : ""}₹{Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </div>
    </div>
  );
}
