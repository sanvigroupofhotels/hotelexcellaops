import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IndianRupee, Calculator, ChevronLeft, ChevronRight, Printer, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  listStaffHr, listAttendance, listAdvances, listSalaryPayments, upsertSalaryPayment,
  getSalaryBasis, setSalaryBasis, createAdvance, deleteAdvance, markAdvanceRecovered,
  monthKey, monthRange, computeSalary,
  type ComputedSalary, type SalaryStatus,
} from "@/lib/staff-hr-api";
import { useUserRole } from "@/hooks/use-role";

export const Route = createFileRoute("/_authenticated/salary")({ component: SalaryPage });

const inputCls = "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40";

function inr(n: number) { return `₹${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }

function SalaryPage() {
  const { isAdmin } = useUserRole();
  const [monthDate, setMonthDate] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const month = monthKey(monthDate);

  function shiftMonth(delta: number) {
    const d = new Date(monthDate); d.setMonth(d.getMonth() + delta); d.setDate(1); setMonthDate(d);
  }

  return (
    <div className="min-h-screen">
      <Topbar title="Salary" subtitle="Compute and pay monthly salaries" />
      <main className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => shiftMonth(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="flex items-center gap-2">
              <IndianRupee className="h-5 w-5 text-gold" />
              <span className="font-display text-xl">
                {monthDate.toLocaleString(undefined, { month: "long", year: "numeric" })}
              </span>
            </div>
            <Button variant="ghost" size="icon" onClick={() => shiftMonth(1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <BasisSwitcher disabled={!isAdmin} />
        </div>

        <Tabs defaultValue="payroll">
          <TabsList>
            <TabsTrigger value="payroll">Payroll</TabsTrigger>
            <TabsTrigger value="advances">Advances</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
          <TabsContent value="payroll">
            <PayrollTab month={month} canEdit={isAdmin} />
          </TabsContent>
          <TabsContent value="advances">
            <AdvancesTab month={month} canEdit={isAdmin} />
          </TabsContent>
          <TabsContent value="reports">
            <ReportsTab month={month} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function BasisSwitcher({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["salary-basis"], queryFn: getSalaryBasis });
  const basis = data?.basis ?? "30";
  const m = useMutation({
    mutationFn: (v: "30" | "calendar") => setSalaryBasis(v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["salary-basis"] }); toast.success("Basis updated"); },
  });
  return (
    <div className="flex items-center gap-1 text-xs bg-card border border-border rounded-md p-1">
      <button disabled={disabled} onClick={() => m.mutate("30")}
        className={`px-3 py-1.5 rounded ${basis === "30" ? "bg-gold/20 text-gold" : "text-muted-foreground"}`}>30 Days</button>
      <button disabled={disabled} onClick={() => m.mutate("calendar")}
        className={`px-3 py-1.5 rounded ${basis === "calendar" ? "bg-gold/20 text-gold" : "text-muted-foreground"}`}>Calendar Days</button>
    </div>
  );
}

function PayrollTab({ month, canEdit }: { month: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const range = monthRange(month);
  const { data: staff = [] } = useQuery({ queryKey: ["staff-hr-active"], queryFn: () => listStaffHr(true) });
  const { data: attendance = [] } = useQuery({
    queryKey: ["attendance", range.from, range.to],
    queryFn: () => listAttendance({ from: range.from, to: range.to }),
  });
  const { data: advances = [] } = useQuery({ queryKey: ["advances", "unrecovered"], queryFn: () => listAdvances({ unrecovered: true }) });
  const { data: payments = [] } = useQuery({ queryKey: ["salary-payments", month], queryFn: () => listSalaryPayments({ month }) });
  const { data: basisData } = useQuery({ queryKey: ["salary-basis"], queryFn: getSalaryBasis });
  const basis = basisData?.basis ?? "30";

  const rows: ComputedSalary[] = useMemo(() => {
    return staff.map((s) => {
      const existing = payments.find((p) => p.staff_id === s.id) ?? null;
      const unrec = advances.filter((a) => a.staff_id === s.id).reduce((sum, a) => sum + Number(a.amount), 0);
      return computeSalary({ staff: s, month, basis, attendance, unrecoveredAdvanceTotal: unrec, existing });
    });
  }, [staff, attendance, advances, payments, month, basis]);

  const [editing, setEditing] = useState<ComputedSalary | null>(null);

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border overflow-x-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="text-right">Monthly</TableHead>
              <TableHead className="text-center">P / A / H / L</TableHead>
              <TableHead className="text-right">Per Day</TableHead>
              <TableHead className="text-right">Deductions</TableHead>
              <TableHead className="text-right">Bonus+Inc</TableHead>
              <TableHead className="text-right">Adv. Rec.</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No active staff</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.staff_id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right">{inr(r.monthly_salary)}</TableCell>
                <TableCell className="text-center text-xs font-mono">
                  {r.present_days}/{r.absent_days}/{r.halfday_count}/{r.leave_days}
                </TableCell>
                <TableCell className="text-right text-xs">{inr(r.per_day)}</TableCell>
                <TableCell className="text-right text-red-400">−{inr(r.absent_deduction + r.halfday_deduction + r.other_deductions)}</TableCell>
                <TableCell className="text-right text-emerald-400">+{inr(r.bonus + r.incentives)}</TableCell>
                <TableCell className="text-right">
                  <div>{inr(r.advance_recovery)}</div>
                  {r.unrecovered_advance_total > 0 && (
                    <div className="text-[10px] text-amber-400">unrec: {inr(r.unrecovered_advance_total)}</div>
                  )}
                </TableCell>
                <TableCell className="text-right font-semibold text-gold">{inr(r.net)}</TableCell>
                <TableCell>
                  <StatusPill s={r.payment?.status ?? "Pending"} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                        <Calculator className="h-3.5 w-3.5" /> Process
                      </Button>
                    )}
                    {r.payment && (
                      <Button size="sm" variant="ghost" onClick={() => printSlip(r, month)}>
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editing && (
        <ProcessSalaryDialog
          row={editing}
          month={month}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["salary-payments", month] });
            qc.invalidateQueries({ queryKey: ["advances", "unrecovered"] });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function StatusPill({ s }: { s: SalaryStatus }) {
  const cls: Record<SalaryStatus, string> = {
    Pending: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    Partial: "bg-sky-500/20 text-sky-300 border-sky-500/40",
    Paid: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded border ${cls[s]}`}>{s}</span>;
}

function ProcessSalaryDialog({ row, month, onClose, onSaved }: { row: ComputedSalary; month: string; onClose: () => void; onSaved: () => void }) {
  const range = monthRange(month);
  const [bonus, setBonus] = useState(row.bonus);
  const [incentives, setIncentives] = useState(row.incentives);
  const [otherDed, setOtherDed] = useState(row.other_deductions);
  const [advRec, setAdvRec] = useState(row.advance_recovery || Math.min(row.unrecovered_advance_total, row.net));
  const [paidAmount, setPaidAmount] = useState<number>(row.payment?.paid_amount ?? 0);
  const [paymentMode, setPaymentMode] = useState<string>(row.payment?.payment_mode ?? "Cash");
  const [notes, setNotes] = useState(row.payment?.notes ?? "");

  const gross = row.monthly_salary + bonus + incentives;
  const net = +(gross - row.absent_deduction - row.halfday_deduction - advRec - otherDed).toFixed(2);
  const status: SalaryStatus = paidAmount <= 0 ? "Pending" : paidAmount >= net ? "Paid" : "Partial";

  const save = useMutation({
    mutationFn: async () => {
      await upsertSalaryPayment({
        staff_id: row.staff_id,
        month,
        salary_period_from: range.from,
        salary_period_to: range.to,
        gross,
        bonus, incentives,
        present_days: row.present_days,
        absent_days: row.absent_days,
        halfday_count: row.halfday_count,
        leave_days: row.leave_days,
        absent_deduction: row.absent_deduction,
        halfday_deduction: row.halfday_deduction,
        advance_recovery: advRec,
        other_deductions: otherDed,
        net,
        paid_amount: paidAmount,
        status,
        payment_mode: paidAmount > 0 ? paymentMode : null,
        paid_at: paidAmount > 0 ? new Date().toISOString() : null,
        notes: notes.trim() || null,
      });
      // mark advances recovered up to advRec
      if (advRec > 0) {
        const unrec = await listAdvances({ staff_id: row.staff_id, unrecovered: true });
        let remaining = advRec;
        for (const a of unrec.sort((x, y) => x.advance_date.localeCompare(y.advance_date))) {
          if (remaining <= 0) break;
          if (Number(a.amount) <= remaining) {
            await markAdvanceRecovered(a.id, month);
            remaining -= Number(a.amount);
          } else {
            break; // partial recovery not supported per row; keep simple
          }
        }
      }
    },
    onSuccess: () => { toast.success("Salary processed"); onSaved(); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Process Salary — {row.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Line label="Period">{range.from} → {range.to}</Line>
            <Line label="Monthly">{inr(row.monthly_salary)}</Line>
            <Line label="P / A / H / L">{row.present_days}/{row.absent_days}/{row.halfday_count}/{row.leave_days}</Line>
            <Line label="Per Day">{inr(row.per_day)}</Line>
            <Line label="Absent Ded.">−{inr(row.absent_deduction)}</Line>
            <Line label="HalfDay Ded.">−{inr(row.halfday_deduction)}</Line>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Bonus (₹)"><input type="number" className={inputCls} value={bonus} onChange={(e) => setBonus(Number(e.target.value) || 0)} /></Field>
            <Field label="Incentives (₹)"><input type="number" className={inputCls} value={incentives} onChange={(e) => setIncentives(Number(e.target.value) || 0)} /></Field>
            <Field label={`Advance Recovery (₹) — unrec ${inr(row.unrecovered_advance_total)}`}>
              <input type="number" className={inputCls} value={advRec} onChange={(e) => setAdvRec(Number(e.target.value) || 0)} />
            </Field>
            <Field label="Other Deductions (₹)"><input type="number" className={inputCls} value={otherDed} onChange={(e) => setOtherDed(Number(e.target.value) || 0)} /></Field>
          </div>

          <div className="rounded-md bg-card/50 border border-border p-3 grid grid-cols-2 gap-y-1 text-xs">
            <span>Gross</span><span className="text-right">{inr(gross)}</span>
            <span>Total Deductions</span><span className="text-right text-red-400">−{inr(row.absent_deduction + row.halfday_deduction + advRec + otherDed)}</span>
            <span className="font-semibold pt-1 border-t border-border/40">Net Payable</span><span className="text-right font-semibold text-gold pt-1 border-t border-border/40">{inr(net)}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Paid Amount (₹)"><input type="number" className={inputCls} value={paidAmount} onChange={(e) => setPaidAmount(Number(e.target.value) || 0)} /></Field>
            <Field label="Payment Mode">
              <select className={inputCls} value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                <option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option>
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Status</span>
            <StatusPill s={status} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 px-2 py-1.5 bg-card/40 rounded border border-border/40">
      <span className="text-muted-foreground">{label}</span><span className="font-medium">{children}</span>
    </div>
  );
}

function printSlip(r: ComputedSalary, month: string) {
  const range = monthRange(month);
  const html = `<!doctype html><html><head><title>Salary Slip — ${r.name} ${month}</title>
  <style>
    body{font-family:system-ui,sans-serif;padding:32px;color:#222;max-width:640px;margin:0 auto;}
    h1{margin:0 0 4px;font-size:22px;}
    .muted{color:#666;font-size:12px;}
    table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px;}
    td{padding:6px 8px;border-bottom:1px solid #eee;}
    td.r{text-align:right;}
    .total{font-weight:700;font-size:15px;background:#f7f5ee;}
    .head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:16px;border-bottom:2px solid #b48a3a;padding-bottom:8px;}
  </style></head><body>
  <div class="head">
    <div><h1>Hotel Excella</h1><div class="muted">Salary Slip</div></div>
    <div class="muted">Period: ${range.from} → ${range.to}</div>
  </div>
  <div><strong>${r.name}</strong></div>
  <table>
    <tr><td>Monthly Salary</td><td class="r">₹${r.monthly_salary.toLocaleString()}</td></tr>
    <tr><td>Bonus</td><td class="r">₹${r.bonus.toLocaleString()}</td></tr>
    <tr><td>Incentives</td><td class="r">₹${r.incentives.toLocaleString()}</td></tr>
    <tr><td><strong>Gross</strong></td><td class="r"><strong>₹${(r.monthly_salary + r.bonus + r.incentives).toLocaleString()}</strong></td></tr>
    <tr><td>Days — P/A/H/L</td><td class="r">${r.present_days}/${r.absent_days}/${r.halfday_count}/${r.leave_days}</td></tr>
    <tr><td>Per Day Rate</td><td class="r">₹${r.per_day.toLocaleString()}</td></tr>
    <tr><td>Absent Deduction</td><td class="r">−₹${r.absent_deduction.toLocaleString()}</td></tr>
    <tr><td>Half-Day Deduction</td><td class="r">−₹${r.halfday_deduction.toLocaleString()}</td></tr>
    <tr><td>Advance Recovery</td><td class="r">−₹${r.advance_recovery.toLocaleString()}</td></tr>
    <tr><td>Other Deductions</td><td class="r">−₹${r.other_deductions.toLocaleString()}</td></tr>
    <tr class="total"><td>Net Payable</td><td class="r">₹${r.net.toLocaleString()}</td></tr>
  </table>
  <p class="muted" style="margin-top:32px;">Generated on ${new Date().toLocaleDateString()}</p>
  <script>window.print();</script>
  </body></html>`;
  const w = window.open("", "_blank"); if (w) { w.document.write(html); w.document.close(); }
}

// ---------- Advances tab ----------
function AdvancesTab({ month, canEdit }: { month: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const { data: staff = [] } = useQuery({ queryKey: ["staff-hr-active"], queryFn: () => listStaffHr(true) });
  const { data: advances = [] } = useQuery({ queryKey: ["advances", "all"], queryFn: () => listAdvances() });

  const [open, setOpen] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!staffId) throw new Error("Select staff");
      if (!(amount > 0)) throw new Error("Amount must be > 0");
      await createAdvance({ staff_id: staffId, amount, advance_date: date, notes: notes || null });
    },
    onSuccess: () => {
      toast.success("Advance recorded"); setOpen(false); setStaffId(""); setAmount(0); setNotes("");
      qc.invalidateQueries({ queryKey: ["advances"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const del = useMutation({
    mutationFn: deleteAdvance,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["advances"] }); toast.success("Deleted"); },
  });

  const nameById = new Map(staff.map((s) => [s.id, s.name]));
  const unrec = advances.filter((a) => !a.recovered_in_month).reduce((s, a) => s + Number(a.amount), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-muted-foreground">
          Total unrecovered: <span className="text-amber-400 font-semibold">{inr(unrec)}</span>
        </div>
        {canEdit && (
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Record Advance</Button>
        )}
      </div>
      <div className="rounded-md border border-border overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Recovered In</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {advances.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No advances</TableCell></TableRow>
            )}
            {advances.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-xs">{a.advance_date}</TableCell>
                <TableCell>{nameById.get(a.staff_id) ?? "—"}</TableCell>
                <TableCell className="text-right">{inr(Number(a.amount))}</TableCell>
                <TableCell className="text-xs">
                  {a.recovered_in_month
                    ? <span className="text-emerald-400">{a.recovered_in_month}</span>
                    : <span className="text-amber-400">Pending</span>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{a.notes ?? "—"}</TableCell>
                <TableCell className="text-right">
                  {canEdit && !a.recovered_in_month && (
                    <Button variant="ghost" size="icon" onClick={() => del.mutate(a.id)}>
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Salary Advance</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="Employee *">
              <select className={inputCls} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                <option value="">Select...</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Date">
              <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Amount (₹) *">
              <input type="number" className={inputCls} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
            </Field>
            <Field label="Notes">
              <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
