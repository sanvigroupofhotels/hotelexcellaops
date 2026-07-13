import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { useUserRole } from "@/hooks/use-role";
import {
  listCashTx, createCashTx, updateCashTx, softDeleteCashTx, reactivateCashTx, hardDeleteCashTx,
  getCashTxCreator, listCashTxActivities,
  listStaff, createStaff, updateStaff,
  listExpenseTypes, createExpenseType, updateExpenseType,
  COLLECTION_TYPES, type CashTxRow,
  uploadCashTxAttachment,
} from "@/lib/cash-api";
import {
  CashTxAttachmentsPanel, CashTxAttachmentsViewer,
  requiresCashOutAttachment, type StagedAttachment,
} from "@/components/cash-tx-attachments";
import { listBookings } from "@/lib/bookings-api";
import { toast } from "sonner";
import { useMasterData } from "@/hooks/use-master-data";
import {
  Plus, Wallet, ArrowDownCircle, ArrowUpCircle, Loader2, Search, X,
  Users as UsersIcon, ListChecks, History as HistoryIcon, Trash2, Download,
  Pencil, PowerOff, Power, Clock, User as UserIcon, ClipboardCopy,
  Lock, Unlock, ShieldCheck,
} from "lucide-react";
import {
  listCashAuditCloses, getActiveAuditClose, createCashAuditClose, reopenCashAuditClose,
  listCashAuditActivities, isTxLocked, type CashAuditClose,
} from "@/lib/cash-audit-api";
import { cn, toLocalYMD, smartDateTime } from "@/lib/utils";
import { downloadCSV } from "@/lib/csv";
import { NumField } from "@/components/num-field";
import { MetricCard, Money } from "@/components/money";

export const Route = createFileRoute("/_authenticated/cash")({
  validateSearch: (s: Record<string, unknown>) => ({
    new: s.new === "expense" || s.new === "collection" ? (s.new as "expense" | "collection") : undefined,
  }),
  component: CashPage,
});

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

type RangeKey = "all" | "today" | "yesterday" | "week" | "prevWeek" | "month" | "prevMonth" | "custom";

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This Week" },
  { value: "prevWeek", label: "Previous Week" },
  { value: "month", label: "This Month" },
  { value: "prevMonth", label: "Previous Month" },
  { value: "custom", label: "Custom" },
];

function ymd(d: Date) {
  const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,"0"); const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function presetDates(key: RangeKey): { from: string; to: string } | null {
  const now = new Date();
  const today = new Date(now); today.setHours(0,0,0,0);
  if (key === "today") return { from: ymd(today), to: ymd(today) };
  if (key === "yesterday") { const d = new Date(today); d.setDate(d.getDate()-1); return { from: ymd(d), to: ymd(d) }; }
  if (key === "week") {
    const s = new Date(today); s.setDate(s.getDate() - s.getDay());
    const e = new Date(s); e.setDate(s.getDate()+6);
    return { from: ymd(s), to: ymd(e) };
  }
  if (key === "prevWeek") {
    const s = new Date(today); s.setDate(s.getDate() - s.getDay() - 7);
    const e = new Date(s); e.setDate(s.getDate()+6);
    return { from: ymd(s), to: ymd(e) };
  }
  if (key === "month") {
    const s = new Date(today.getFullYear(), today.getMonth(), 1);
    const e = new Date(today.getFullYear(), today.getMonth()+1, 0);
    return { from: ymd(s), to: ymd(e) };
  }
  if (key === "prevMonth") {
    const s = new Date(today.getFullYear(), today.getMonth()-1, 1);
    const e = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: ymd(s), to: ymd(e) };
  }
  return null;
}

function rangeBounds(from?: string, to?: string) {
  return {
    from: from ? new Date(from + "T00:00:00").toISOString() : undefined,
    to: to ? new Date(to + "T23:59:59").toISOString() : undefined,
  };
}

function exportCashCSV(tx: CashTxRow[], range: RangeKey) {
  if (tx.length === 0) { toast.error("No transactions to export"); return; }
  const rows = tx.map(t => ({
    Date: new Date(t.occurred_at).toLocaleString("en-IN"),
    Kind: t.kind === "collection" ? "In" : "Out",
    Category: t.type_name,
    "Other Type": t.description ?? "",
    Guest: t.guest_name ?? "",
    Mobile: t.guest_mobile ?? "",
    Room: t.room_number ?? "",
    Staff: t.staff_name ?? "",
    Amount: Number(t.amount),
    Notes: t.notes ?? "",
    Active: t.active ? "Yes" : "No",
  }));
  downloadCSV(`cash-${range}-${toLocalYMD()}.csv`, rows);
  toast.success("Exported");
}
import { buildDailyCashReport, computeOpeningBalance, printCashReport } from "@/lib/cash-report";
import { Printer } from "lucide-react";


function CashPage() {
  const { isAdmin, canManage } = useUserRole();
  const routeSearch = Route.useSearch();
  const [tab, setTab] = useState<"dashboard" | "audit">("dashboard");
  const [openForm, setOpenForm] = useState<null | { kind: "collection" | "expense"; tx?: CashTxRow }>(
    routeSearch.new ? { kind: routeSearch.new } : null,
  );
  const [detailTx, setDetailTx] = useState<CashTxRow | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Main dashboard is ALWAYS All-Time. Filters live in the Reports modal.
  const { data: tx = [] } = useQuery({
    queryKey: ["cash-tx", "all-time"],
    queryFn: () => listCashTx({}),
  });

  const totals = useMemo(() => {
    let collected = 0, spent = 0, ownerPaid = 0;
    for (const t of tx) {
      if (!t.active) continue;
      if (t.kind === "collection") collected += Number(t.amount);
      else {
        spent += Number(t.amount);
        if ((t.type_name || "").toLowerCase() === "handed over to owner") ownerPaid += Number(t.amount);
      }
    }
    return { collected, spent, balance: collected - spent, ownerPaid };
  }, [tx]);

  // Search by remark/notes/description/guest or amount
  const filteredHistory = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return tx;
    const asNumber = Number(s);
    return tx.filter((t) => {
      if (!isNaN(asNumber) && Number(t.amount) === asNumber) return true;
      return [t.notes, t.description, t.guest_name, t.type_name, t.staff_name, t.room_number]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
    });
  }, [tx, search]);

  return (
    <>
      <Topbar title="CashBook" subtitle={isAdmin ? "All-time cash collections, expenses & balance" : "Current cash balance"} />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] pb-32 lg:pb-8 space-y-6">
        {/* Tabs — admins see Audit Close, staff masters live in Master Data */}
        {isAdmin && (
          <div className="flex items-center gap-2 border-b border-border overflow-x-auto">
            <TabBtn active={tab==="dashboard"} onClick={() => setTab("dashboard")} icon={HistoryIcon}>Dashboard</TabBtn>
            <TabBtn active={tab==="audit"} onClick={() => setTab("audit")} icon={ShieldCheck}>Audit Close</TabBtn>
          </div>
        )}

        {tab === "dashboard" && (
          <>
            {/* Top cards — admins see In/Out/Balance/Owner-Paid; staff only see Balance */}
            {isAdmin ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                <StatCard label="Total In (+)" value={totals.collected} icon={ArrowDownCircle} tone="success" />
                <StatCard label="Total Out (-)" value={totals.spent} icon={ArrowUpCircle} tone="danger" />
                <StatCard label="Net Balance" value={totals.balance} icon={Wallet} tone="gold" />
                <StatCard label="Total Paid to Owner" value={totals.ownerPaid} icon={ArrowUpCircle} tone="gold" />
              </div>
            ) : (
              <div className="flex justify-center">
                <div className="w-full max-w-sm">
                  <StatCard label="Current Cash Balance" value={totals.balance} icon={Wallet} tone="gold" centered />
                </div>
              </div>
            )}

            {/* Copy Today's Report — centered card (matches Current Cash Balance) */}
            <div className="flex justify-center">
              <div className="w-full max-w-sm">
                <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}}
                  className="luxe-card rounded-xl p-5 flex flex-col items-center text-center gap-2">
                  <button onClick={async () => {
                      try {
                        const today = new Date(); today.setHours(0,0,0,0);
                        const opening = computeOpeningBalance(tx, today);
                        const report = buildDailyCashReport(tx, today, opening);
                        await navigator.clipboard.writeText(report);
                        toast.success("Today's report copied to clipboard.");
                      } catch (e: any) {
                        toast.error(e?.message ?? "Could not copy report");
                      }
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-gold/40 bg-gold-soft/30 px-4 py-2 text-sm hover:bg-gold-soft/50">
                    <ClipboardCopy className="h-4 w-4" /> Copy Today's Report
                  </button>
                </motion.div>
              </div>
            </div>

            {/* Primary actions */}
            <div className="space-y-3">
              <div className="grid gap-3 grid-cols-2">
                <button onClick={()=>setOpenForm({ kind: "collection" })}
                  className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-medium text-white transition hover:brightness-110"
                  style={{ background: "linear-gradient(135deg, oklch(0.65 0.18 150), oklch(0.55 0.18 150))" }}>
                  (+) Cash In
                </button>
                <button onClick={()=>setOpenForm({ kind: "expense" })}
                  className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-medium text-white transition hover:brightness-110"
                  style={{ background: "linear-gradient(135deg, oklch(0.62 0.22 25), oklch(0.52 0.22 25))" }}>
                  (-) Cash Out
                </button>
              </div>
              {isAdmin && (
                <div className="flex justify-center">
                  <button onClick={() => setReportsOpen(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-gold/40 bg-gold-soft/30 px-6 py-2.5 text-sm hover:bg-gold-soft/50">
                    📊 View Reports
                  </button>
                </div>
              )}
            </div>

            {/* Search */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <input value={search} onChange={(e)=>setSearch(e.target.value)}
                placeholder="Search by remark or amount…"
                className="bg-transparent outline-none text-sm flex-1" />
              {search && <button onClick={()=>setSearch("")} className="text-[10px] uppercase text-muted-foreground hover:text-foreground">Clear</button>}
            </div>

            <SimpleHistory tx={filteredHistory} allTx={tx} isAdmin={isAdmin} canManage={canManage}
              onEdit={(t) => setOpenForm({ kind: t.kind, tx: t })}
              onOpen={(t) => setDetailTx(t)} />
          </>
        )}

        {tab === "audit" && isAdmin && <AuditClosePanel />}
      </div>

      {openForm && (
        <TxFormModal kind={openForm.kind} edit={openForm.tx} onClose={()=>setOpenForm(null)} />
      )}
      {detailTx && (
        <TxDetailModal tx={detailTx} onClose={()=>setDetailTx(null)}
          onEdit={() => { setOpenForm({ kind: detailTx.kind, tx: detailTx }); setDetailTx(null); }} />
      )}
      {reportsOpen && (
        <ReportsModal tx={tx} onClose={() => setReportsOpen(false)} />
      )}
    </>
  );
}

// ---------- Simple history list (no inline filters; advanced filters live in Reports modal) ----------
function SimpleHistory({ tx, allTx, isAdmin, canManage, onEdit, onOpen }: {
  tx: CashTxRow[]; allTx: CashTxRow[]; isAdmin: boolean; canManage: boolean;
  onEdit: (t: CashTxRow) => void; onOpen: (t: CashTxRow) => void;
}) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<CashTxRow | null>(null);
  const deact = useMutation({ mutationFn: softDeleteCashTx, onSuccess: () => { toast.success("Deactivated"); qc.invalidateQueries({ queryKey:["cash-tx"] }); }, onError: (e:any) => toast.error(e.message) });
  const react = useMutation({ mutationFn: reactivateCashTx, onSuccess: () => { toast.success("Reactivated"); qc.invalidateQueries({ queryKey:["cash-tx"] }); }, onError: (e:any) => toast.error(e.message) });
  const hard = useMutation({ mutationFn: hardDeleteCashTx, onSuccess: () => { toast.success("Deleted"); setConfirmDelete(null); qc.invalidateQueries({ queryKey:["cash-tx"] }); }, onError: (e:any) => toast.error(e.message) });

  // Running balance across ENTIRE active history (chronological). Map keyed by tx id.
  const balanceById = useMemo(() => {
    const sorted = [...allTx].filter(t => t.active).sort((a, b) =>
      a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0
    );
    const map: Record<string, number> = {};
    let bal = 0;
    for (const t of sorted) {
      bal += t.kind === "collection" ? Number(t.amount) : -Number(t.amount);
      map[t.id] = bal;
    }
    return map;
  }, [allTx]);

  return (
    <div className="luxe-card rounded-xl p-4 md:p-5">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Transaction History</div>
      <div className="overflow-x-auto -mx-4 md:mx-0">
        <table className="w-full text-sm min-w-[920px]">
          <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Balance</th>
              <th className="px-3 py-2">Notes</th>
              <th className="px-3 py-2">Guest</th>
              <th className="px-3 py-2">Entered By</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tx.length === 0 && (<tr><td colSpan={9} className="text-center text-muted-foreground py-8">No transactions</td></tr>)}
            {tx.map(t => (
              <tr key={t.id} className={cn("border-b border-border/60 hover:bg-secondary/40", !t.active && "opacity-50")}>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{smartDateTime(t.occurred_at)}</td>
                <td className="px-3 py-2">
                  <span className={cn("text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 font-bold border",
                    t.kind==="collection"
                      ? "bg-success/25 text-success border-success/40"
                      : "bg-destructive/25 text-destructive border-destructive/40")}>
                    {t.kind==="collection"?"IN":"OUT"}
                  </span>
                  {!t.active && <span className="ml-1 text-[9px] uppercase text-muted-foreground">Inactive</span>}
                </td>
                <td className="px-3 py-2">
                  {t.type_name}
                  {t.description ? <span className="block text-[10px] text-muted-foreground">{t.description}</span> : null}
                  {t.booking_id && <Link to="/bookings/$id" params={{id:t.booking_id}} className="block text-[10px] text-gold hover:underline">View booking</Link>}
                </td>
                <td className={cn("px-3 py-2 text-right font-medium tabular-nums",
                  t.kind==="collection" ? "text-success" : "text-destructive")}>
                  {t.kind==="collection"?"+":"-"}₹{Number(t.amount).toLocaleString("en-IN")}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[12px]">
                  {t.active ? (
                    <span className={cn(
                      (balanceById[t.id] ?? 0) < 0 ? "text-destructive" : "text-muted-foreground",
                    )}>
                      ₹{Math.abs(balanceById[t.id] ?? 0).toLocaleString("en-IN")}
                      {(balanceById[t.id] ?? 0) < 0 && " ⚠"}
                    </span>
                  ) : <span className="text-muted-foreground/60">—</span>}
                </td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground max-w-[180px] truncate" title={t.notes ?? ""}>
                  {t.notes && t.notes.trim() ? t.notes : "—"}
                </td>
                <td className="px-3 py-2">
                  {t.guest_name ?? "—"}
                  {t.guest_mobile && <span className="block text-[10px] text-muted-foreground">{t.guest_mobile}</span>}
                </td>
                <td className="px-3 py-2 text-[11px]">{t.staff_name ?? "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <button title="View / activity" onClick={()=>onOpen(t)} className="p-1 text-muted-foreground hover:text-foreground"><HistoryIcon className="h-4 w-4"/></button>
                    <button title="Edit" onClick={()=>onEdit(t)} className="p-1 text-muted-foreground hover:text-foreground"><Pencil className="h-4 w-4"/></button>
                    {t.active ? (
                      <button title="Deactivate" onClick={()=>{ if (confirm("Deactivate this transaction?")) deact.mutate(t.id); }}
                        className="p-1 text-muted-foreground hover:text-warning"><PowerOff className="h-4 w-4"/></button>
                    ) : canManage ? (
                      <button title="Reactivate" onClick={()=>react.mutate(t.id)}
                        className="p-1 text-muted-foreground hover:text-success"><Power className="h-4 w-4"/></button>
                    ) : null}
                    {isAdmin && (
                      <button title="Delete (admin)" onClick={()=>setConfirmDelete(t)}
                        className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4"/></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete Transaction?"
          message={<>This will permanently delete <strong>{confirmDelete.type_name} · ₹{Number(confirmDelete.amount).toLocaleString("en-IN")}</strong>.<br/><span className="text-destructive">This action cannot be undone.</span></>}
          confirmLabel="Delete permanently"
          danger
          loading={hard.isPending}
          onConfirm={() => hard.mutate(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }: any) {
  return (
    <button onClick={onClick}
      className={cn("inline-flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 -mb-px transition whitespace-nowrap",
        active ? "border-gold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
      <Icon className="h-4 w-4" /> {children}
    </button>
  );
}

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: any; tone: "success"|"danger"|"gold"; centered?: boolean }) {
  const mappedTone = tone === "danger" ? "destructive" : tone;
  return (
    <MetricCard
      label={label}
      value={Math.abs(value)}
      icon={<Icon className="h-4 w-4" />}
      tone={mappedTone as any}
      currency
      sublabel={tone==="gold" && value < 0 ? <span className="text-destructive">Negative — review entries</span> : undefined}
    />
  );
}

// ---------- Transaction History ----------
function TransactionHistory({
  tx, isAdmin, canManage, onEdit, onOpen,
}: {
  tx: CashTxRow[]; isAdmin: boolean; canManage: boolean;
  onEdit: (t: CashTxRow) => void; onOpen: (t: CashTxRow) => void;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<""|"collection"|"expense">("");
  const [type, setType] = useState("");
  const [staff, setStaff] = useState("");
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<CashTxRow | null>(null);

  const deact = useMutation({
    mutationFn: softDeleteCashTx,
    onSuccess: () => { toast.success("Transaction deactivated"); qc.invalidateQueries({ queryKey:["cash-tx"] }); },
    onError: (e:any) => toast.error(e.message),
  });
  const react = useMutation({
    mutationFn: reactivateCashTx,
    onSuccess: () => { toast.success("Transaction reactivated"); qc.invalidateQueries({ queryKey:["cash-tx"] }); },
    onError: (e:any) => toast.error(e.message),
  });
  const hard = useMutation({
    mutationFn: hardDeleteCashTx,
    onSuccess: () => { toast.success("Transaction deleted"); setConfirmDelete(null); qc.invalidateQueries({ queryKey:["cash-tx"] }); },
    onError: (e:any) => toast.error(e.message),
  });

  const filtered = useMemo(() => tx.filter(t => {
    if (kind && t.kind !== kind) return false;
    if (type && t.type_name !== type) return false;
    if (staff && t.staff_name !== staff) return false;
    if (q) {
      const s = q.toLowerCase();
      if (![t.guest_name,t.guest_mobile,t.room_number,t.type_name,t.staff_name,t.notes,t.description]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(s))) return false;
    }
    return true;
  }), [tx, q, kind, type, staff]);

  const types = Array.from(new Set(tx.map(t => t.type_name))).sort();
  const staffs = Array.from(new Set(tx.map(t => t.staff_name).filter(Boolean))) as string[];

  return (
    <div className="luxe-card rounded-xl p-4 md:p-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <div className="col-span-2 md:col-span-1 flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search…" className="bg-transparent outline-none text-sm flex-1 min-w-0" />
        </div>
        <select className={inputCls} value={kind} onChange={e=>setKind(e.target.value as any)}>
          <option value="">All Transaction Types</option><option value="collection">Collections</option><option value="expense">Expenses</option>
        </select>
        <select className={inputCls} value={type} onChange={e=>setType(e.target.value)}>
          <option value="">All Categories</option>
          {types.map(t => <option key={t}>{t}</option>)}
        </select>
        <select className={inputCls} value={staff} onChange={e=>setStaff(e.target.value)}>
          <option value="">All Entered By</option>
          {staffs.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto -mx-4 md:mx-0">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
            <tr>
              <th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Other Type</th>
              <th className="px-3 py-2">Notes</th>
              <th className="px-3 py-2">Guest</th>
              <th className="px-3 py-2">Entered By</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="text-center text-muted-foreground py-8">No transactions</td></tr>
            )}
            {filtered.map(t => (
              <tr key={t.id} className={cn("border-b border-border/60 hover:bg-secondary/40", !t.active && "opacity-50")}>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{new Date(t.occurred_at).toLocaleString("en-IN",{dateStyle:"short",timeStyle:"short"})}</td>
                <td className="px-3 py-2">
                  <span className={cn("text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5",
                    t.kind==="collection" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                    {t.kind==="collection"?"In":"Out"}
                  </span>
                  {!t.active && <span className="ml-1 text-[9px] uppercase text-muted-foreground">Inactive</span>}
                </td>
                <td className="px-3 py-2">
                  {t.type_name}
                  {t.booking_id && <Link to="/bookings/$id" params={{id:t.booking_id}} className="block text-[10px] text-gold hover:underline">View booking</Link>}
                </td>
                <td className="px-3 py-2 text-[11px] max-w-[180px] truncate" title={t.description ?? ""}>
                  {t.description && t.description.trim() ? t.description : "—"}
                </td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground max-w-[200px] truncate" title={t.notes ?? ""}>
                  {t.notes && t.notes.trim() ? t.notes : "—"}
                </td>
                <td className="px-3 py-2">
                  {t.guest_name ?? "—"}
                  {t.guest_mobile && <span className="block text-[10px] text-muted-foreground">{t.guest_mobile}</span>}
                </td>
                <td className="px-3 py-2 text-[11px]">{t.staff_name ?? "—"}</td>
                <td className={cn("px-3 py-2 text-right font-medium tabular-nums",
                  t.kind==="collection" ? "text-success" : "text-destructive")}>
                  {t.kind==="collection"?"+":"-"}₹{Number(t.amount).toLocaleString("en-IN")}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <button title="View / activity" onClick={()=>onOpen(t)} className="p-1 text-muted-foreground hover:text-foreground"><HistoryIcon className="h-4 w-4"/></button>
                    <button title="Edit" onClick={()=>onEdit(t)} className="p-1 text-muted-foreground hover:text-foreground"><Pencil className="h-4 w-4"/></button>
                    {t.active ? (
                      <button title="Deactivate" onClick={()=>{ if (confirm("Deactivate this transaction?")) deact.mutate(t.id); }}
                        className="p-1 text-muted-foreground hover:text-warning"><PowerOff className="h-4 w-4"/></button>
                    ) : canManage ? (
                      <button title="Reactivate" onClick={()=>react.mutate(t.id)}
                        className="p-1 text-muted-foreground hover:text-success"><Power className="h-4 w-4"/></button>
                    ) : null}
                    {isAdmin && (
                      <button title="Delete (admin)" onClick={()=>setConfirmDelete(t)}
                        className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4"/></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete Transaction?"
          message={<>This will permanently delete <strong>{confirmDelete.type_name} · ₹{Number(confirmDelete.amount).toLocaleString("en-IN")}</strong>.<br/><span className="text-destructive">This action cannot be undone.</span></>}
          confirmLabel="Delete permanently"
          danger
          loading={hard.isPending}
          onConfirm={() => hard.mutate(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function ConfirmDialog({ title, message, confirmLabel, danger, loading, onConfirm, onCancel }: {
  title: string; message: React.ReactNode; confirmLabel: string; danger?: boolean; loading?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onCancel}>
      <div onClick={e=>e.stopPropagation()} className="w-full max-w-md bg-card border border-border rounded-xl p-6 shadow-2xl">
        <h3 className="font-display text-lg mb-2">{title}</h3>
        <div className="text-sm text-muted-foreground mb-5">{message}</div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-md border border-border">Cancel</button>
          <button onClick={onConfirm} disabled={loading}
            className={cn("inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md font-medium text-white disabled:opacity-60",
              danger ? "bg-destructive hover:bg-destructive/90" : "gold-gradient text-charcoal")}>
            {loading && <Loader2 className="h-4 w-4 animate-spin"/>}{confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Tx Detail / Activity Modal ----------
function TxDetailModal({ tx, onClose, onEdit }: { tx: CashTxRow; onClose: () => void; onEdit: () => void }) {
  const { data: activities = [] } = useQuery({
    queryKey: ["cash-tx-activities", tx.id],
    queryFn: () => listCashTxActivities(tx.id),
  });
  const { data: creator } = useQuery({
    queryKey: ["cash-tx-creator", tx.id],
    queryFn: () => getCashTxCreator(tx),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm p-0 md:p-4" onClick={onClose}>
      <motion.div initial={{y:40,opacity:0}} animate={{y:0,opacity:1}}
        onClick={e=>e.stopPropagation()}
        className="w-full md:max-w-2xl bg-card border border-border rounded-t-2xl md:rounded-xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg">{tx.kind==="collection"?"Cash Collection":"Cash Expense"}</h3>
            <p className="text-[11px] text-muted-foreground">{tx.type_name} · ₹{Number(tx.amount).toLocaleString("en-IN")}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onEdit} className="p-2 text-muted-foreground hover:text-foreground" title="Edit"><Pencil className="h-4 w-4"/></button>
            <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground"><X className="h-5 w-5"/></button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          {/* Entered By prominent */}
          <div className="rounded-lg border border-gold/30 bg-gold-soft/30 p-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><UserIcon className="h-3 w-3"/> Entered By</div>
              <div className="font-medium mt-0.5">{creator?.name ?? "—"} {creator?.role && <span className="text-[10px] text-muted-foreground">({creator.role})</span>}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3"/> Created</div>
              <div className="font-medium mt-0.5">{new Date(creator?.at ?? tx.created_at).toLocaleString("en-IN")}</div>
            </div>
          </div>

          {/* Details */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <DetailRow label="Category" value={tx.type_name} />
            <DetailRow label="Amount" value={`₹${Number(tx.amount).toLocaleString("en-IN")}`} />
            {tx.description && <DetailRow label="Description" value={tx.description} />}
            {tx.guest_name && <DetailRow label="Guest" value={tx.guest_name} />}
            {tx.guest_mobile && <DetailRow label="Mobile" value={tx.guest_mobile} />}
            {tx.room_number && <DetailRow label="Room" value={tx.room_number} />}
            {tx.staff_name && <DetailRow label="Staff" value={tx.staff_name} />}
            <DetailRow label="Date/Time" value={new Date(tx.occurred_at).toLocaleString("en-IN")} />
            <DetailRow label="Status" value={tx.active ? "Active" : "Inactive"} />
            {tx.booking_id && <DetailRow label="Booking" value={<Link to="/bookings/$id" params={{id:tx.booking_id}} className="text-gold hover:underline">Open booking</Link>} />}
            {tx.notes && <DetailRow label="Notes" value={tx.notes} full />}
          </div>

          {/* Activity History */}
          <div className="border-t border-border pt-4">
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2"><HistoryIcon className="h-4 w-4 text-gold"/> Activity History</h4>
            <div className="space-y-3">
              {activities.length === 0 && <p className="text-xs text-muted-foreground">No activity recorded.</p>}
              {activities.map(a => (
                <div key={a.id} className="flex gap-3 text-sm">
                  <div className={cn("mt-1 h-2 w-2 rounded-full shrink-0",
                    a.action==="created" ? "bg-success" : a.action==="deleted" ? "bg-destructive" :
                    a.action==="deactivated" ? "bg-warning" : a.action==="reactivated" ? "bg-success" : "bg-gold")} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(a.created_at).toLocaleString("en-IN")} · {a.actor_name ?? "Unknown"} {a.actor_role && <span className="text-[10px]">({a.actor_role})</span>}
                    </div>
                    <div className="text-sm">{a.summary ?? a.action}</div>
                    {a.field && (a.old_value || a.new_value) && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">{a.field}:</span>{" "}
                        <span className="line-through">{a.old_value ?? "—"}</span>{" → "}
                        <span className="text-foreground">{a.new_value ?? "—"}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function DetailRow({ label, value, full }: { label: string; value: React.ReactNode; full?: boolean }) {
  return (
    <div className={cn(full && "col-span-2")}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

// ---------- Tx Form Modal (Create + Edit) ----------
function TxFormModal({ kind, edit, onClose }: { kind: "collection"|"expense"; edit?: CashTxRow; onClose: ()=>void }) {
  const qc = useQueryClient();
  const { isAdmin, isOwner } = useUserRole();
  const canBypassAttachmentRule = isAdmin || isOwner;
  const { data: staff = [] } = useQuery({ queryKey: ["staff","active","cashbook"], queryFn: () => listStaff(true, { availability: "cashbook" }) });
  const { data: etypes = [] } = useQuery({ queryKey: ["etypes","active"], queryFn: () => listExpenseTypes(true) });
  const { values: incomeTypes } = useMasterData("income_category", [...COLLECTION_TYPES]);
  const { data: bookings = [] } = useQuery({
    queryKey: ["bookings-cash-pick"],
    queryFn: listBookings,
    enabled: kind === "collection",
  });

  const isEdit = !!edit;
  const [typeName, setTypeName] = useState<string>(edit?.type_name ?? (kind === "collection" ? (incomeTypes[0] ?? COLLECTION_TYPES[0]) : (etypes[0]?.name ?? "")));
  const [description, setDescription] = useState(edit?.description ?? "");
  const [guestName, setGuestName] = useState(edit?.guest_name ?? "");
  const [guestMobile, setGuestMobile] = useState(edit?.guest_mobile ?? "");
  const [roomNumber, setRoomNumber] = useState(edit?.room_number ?? "");
  const [bookingId, setBookingId] = useState<string | null>(edit?.booking_id ?? null);
  const [bookingSearch, setBookingSearch] = useState("");
  const [staffId, setStaffId] = useState<string>(edit?.staff_id ?? "");
  const [amount, setAmount] = useState<number>(edit?.amount ?? 0);
  const [notes, setNotes] = useState(edit?.notes ?? "");
  const [occurredAt, setOccurredAt] = useState<string>(() => {
    const d = edit ? new Date(edit.occurred_at) : new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0,16);
  });
  const [staged, setStaged] = useState<StagedAttachment[]>([]);

  const isOther = typeName === "Other" || typeName === "Others";
  if (kind==="expense" && etypes.length>0 && !typeName) {
    queueMicrotask(() => setTypeName(etypes[0].name));
  }

  const filteredBookings = useMemo(() => {
    const s = bookingSearch.trim().toLowerCase();
    if (!s) return bookings.slice(0, 5);
    return bookings.filter(b =>
      b.booking_reference.toLowerCase().includes(s)
      || b.guest_name.toLowerCase().includes(s)
      || (b.phone ?? "").toLowerCase().includes(s),
    ).slice(0, 8);
  }, [bookingSearch, bookings]);

  const selectedBooking = bookings.find(b => b.id === bookingId);

  const payload = () => ({
    kind, type_name: typeName,
    description: isOther ? description : null,
    guest_name: guestName || null,
    guest_mobile: guestMobile || null,
    room_number: roomNumber || null,
    booking_id: bookingId,
    staff_id: staffId,
    staff_name: staff.find(s => s.id === staffId)?.name ?? null,
    amount: Number(amount),
    notes: notes || null,
    occurred_at: new Date(occurredAt).toISOString(),
  });

  const attachmentRequired = requiresCashOutAttachment({ kind, amount, canBypass: canBypassAttachmentRule });
  // For NEW tx: staged attachments count. For EDIT: we assume any persisted
  // attachments already meet the rule; the panel manages its own live state.
  const meetsAttachmentRule = !attachmentRequired || isEdit || staged.length > 0;

  const save = useMutation({
    mutationFn: async () => {
      if (isEdit) return updateCashTx(edit!.id, payload());
      const row = await createCashTx(payload());
      // Flush any staged attachments now that we have a tx id.
      for (const s of staged) {
        try { await uploadCashTxAttachment(row.id, s.file); }
        catch (e: any) { toast.error(`Attachment "${s.file.name}" failed: ${e?.message ?? "unknown"}`); }
      }
      return row;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Transaction updated" : (kind==="collection" ? "Collection recorded" : "Expense recorded"));
      qc.invalidateQueries({ queryKey: ["cash-tx"] });
      qc.invalidateQueries({ queryKey: ["cash-tx-activities"] });
      qc.invalidateQueries({ queryKey: ["cash-tx-attachments"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm p-0 md:p-4" onClick={onClose}>
      <motion.div initial={{y:40,opacity:0}} animate={{y:0,opacity:1}}
        onClick={e=>e.stopPropagation()}
        className="w-full md:max-w-xl bg-card border border-border rounded-t-2xl md:rounded-xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center justify-between">
          <h3 className="font-display text-lg">
            {isEdit ? "Edit " : "Add "}{kind==="collection"?"Cash Collection":"Cash Expense"}
          </h3>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-5 w-5"/></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Row 1: Type + (Other Type if needed) + Amount + Notes */}
          <div className={cn("grid grid-cols-1 gap-3", isOther ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
            <Field label={kind==="collection"?"Collection Type":"Expense Type"} required>
              <select className={inputCls} value={typeName} onChange={e=>setTypeName(e.target.value)}>
                {kind==="collection"
                  ? incomeTypes.map(t => <option key={t}>{t}</option>)
                  : etypes.map(t => <option key={t.id}>{t.name}</option>)}
              </select>
            </Field>
            {isOther && (
              <Field label="What's the Other Type?" required>
                <input className={inputCls} value={description} onChange={e=>setDescription(e.target.value)}
                  placeholder="Specify…" />
              </Field>
            )}
            <Field label="Amount (₹)" required>
              <NumField value={amount || 0} min={0} decimal prefix="₹" onChange={(v)=>setAmount(v)} />
            </Field>
            <Field label="Notes">
              <input className={inputCls} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Quick note (optional)" />
            </Field>
          </div>


          {kind==="collection" && !isOther && (
            <>
              {/* Row 2: Related Booking */}
              <Field label="Related Booking (optional)">
                {selectedBooking ? (
                  <div className="flex items-center justify-between rounded-md border border-gold/30 bg-gold-soft/30 px-3 py-2 text-xs">
                    <span><strong className="font-mono">{selectedBooking.booking_reference}</strong> · {selectedBooking.guest_name}</span>
                    <button onClick={()=>setBookingId(null)} className="text-[10px] uppercase text-muted-foreground hover:text-foreground">Clear</button>
                  </div>
                ) : (
                  <>
                    <input className={inputCls} placeholder="Search by reference, name or mobile…"
                      value={bookingSearch} onChange={e=>setBookingSearch(e.target.value)} />
                    {bookingSearch && filteredBookings.length>0 && (
                      <div className="mt-1 max-h-44 overflow-y-auto rounded-md border border-border bg-popover">
                        {filteredBookings.map(b => (
                          <button key={b.id} type="button" onClick={() => {
                            setBookingId(b.id);
                            setGuestName((prev: string) => prev || b.guest_name);
                            setGuestMobile((prev: string) => prev || (b.phone ?? ""));
                            setBookingSearch("");
                          }}
                            className="block w-full text-left px-3 py-2 text-xs hover:bg-secondary/60 border-b border-border last:border-0">
                            <div className="font-mono text-[11px]">{b.booking_reference}</div>
                            <div>{b.guest_name} · {b.phone}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </Field>

              <Field label="Guest Name" required>
                <input className={inputCls} value={guestName} onChange={e=>setGuestName(e.target.value)} />
              </Field>
              <Field label="Mobile Number" required>
                <input className={inputCls} inputMode="tel" value={guestMobile} onChange={e=>setGuestMobile(e.target.value)} />
              </Field>
              <Field label="Room Number">
                <input className={inputCls} value={roomNumber} onChange={e=>setRoomNumber(e.target.value)} />
              </Field>
            </>
          )}


          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={kind==="collection"?"Collected By":"Paid By"} required>
              <select className={inputCls} value={staffId} onChange={e=>setStaffId(e.target.value)}>
                <option value="">Select staff…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {staff.length===0 && <p className="text-[10px] text-muted-foreground mt-1">No active staff. Ask an admin to add staff.</p>}
            </Field>
            <Field label="Date & Time">
              <input type="datetime-local" className={inputCls} value={occurredAt} onChange={e=>setOccurredAt(e.target.value)} />
            </Field>
          </div>
        </div>
        <div className="sticky bottom-0 bg-card border-t border-border px-5 py-3 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-border">Cancel</button>
          <button onClick={()=>save.mutate()} disabled={save.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md gold-gradient text-charcoal font-medium disabled:opacity-60">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin"/>}
            {isEdit ? "Save Changes" : "Save"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}{required && <span className="text-gold ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

// ---------- Masters ----------
function StaffMaster() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({ queryKey: ["staff","all"], queryFn: () => listStaff(false) });
  const [name, setName] = useState(""); const [mobile, setMobile] = useState("");
  const add = useMutation({
    mutationFn: () => createStaff(name, mobile || undefined),
    onSuccess: () => { toast.success("Staff added"); setName(""); setMobile(""); qc.invalidateQueries({ queryKey:["staff"] }); },
    onError: (e:any) => toast.error(e.message),
  });
  const tog = useMutation({
    mutationFn: (s: { id: string; active: boolean }) => updateStaff(s.id, { active: s.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey:["staff"] }),
  });
  return (
    <div className="luxe-card rounded-xl p-5 space-y-4">
      <h3 className="font-display text-lg">Staff Master</h3>
      <div className="flex flex-wrap gap-2">
        <input className={cn(inputCls,"flex-1 min-w-[160px]")} placeholder="Staff name" value={name} onChange={e=>setName(e.target.value)} />
        <input className={cn(inputCls,"flex-1 min-w-[160px]")} placeholder="Mobile (optional)" value={mobile} onChange={e=>setMobile(e.target.value)} />
        <button onClick={()=>name.trim() && add.mutate()} disabled={add.isPending}
          className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2 text-sm text-charcoal font-medium"><Plus className="h-4 w-4"/>Add</button>
      </div>
      <div className="divide-y divide-border">
        {rows.map(s => (
          <div key={s.id} className="flex items-center justify-between py-2.5">
            <div>
              <div className="text-sm">{s.name}</div>
              {s.mobile && <div className="text-[11px] text-muted-foreground">{s.mobile}</div>}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <span className={s.active?"text-success":"text-muted-foreground"}>{s.active?"Active":"Inactive"}</span>
              <input type="checkbox" checked={s.active} onChange={e=>tog.mutate({id:s.id, active:e.target.checked})} />
            </label>
          </div>
        ))}
        {rows.length===0 && <p className="text-sm text-muted-foreground py-4">No staff yet.</p>}
      </div>
    </div>
  );
}

function ExpenseTypeMaster() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({ queryKey: ["etypes","all"], queryFn: () => listExpenseTypes(false) });
  const [name, setName] = useState("");
  const add = useMutation({
    mutationFn: () => createExpenseType(name),
    onSuccess: () => { toast.success("Type added"); setName(""); qc.invalidateQueries({ queryKey:["etypes"] }); },
    onError: (e:any) => toast.error(e.message),
  });
  const tog = useMutation({
    mutationFn: (s: { id: string; active: boolean }) => updateExpenseType(s.id, { active: s.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey:["etypes"] }),
  });
  return (
    <div className="luxe-card rounded-xl p-5 space-y-4">
      <h3 className="font-display text-lg">Expense Type Master</h3>
      <div className="flex gap-2">
        <input className={cn(inputCls,"flex-1")} placeholder="Expense type name" value={name} onChange={e=>setName(e.target.value)} />
        <button onClick={()=>name.trim() && add.mutate()} disabled={add.isPending}
          className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2 text-sm text-charcoal font-medium"><Plus className="h-4 w-4"/>Add</button>
      </div>
      <div className="divide-y divide-border">
        {rows.map(s => (
          <div key={s.id} className="flex items-center justify-between py-2.5">
            <div className="text-sm">{s.name}</div>
            <label className="flex items-center gap-2 text-xs">
              <span className={s.active?"text-success":"text-muted-foreground"}>{s.active?"Active":"Inactive"}</span>
              <input type="checkbox" checked={s.active} onChange={e=>tog.mutate({id:s.id, active:e.target.checked})} />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

// -------- Reports Modal --------
function ReportsModal({ tx, onClose }: { tx: CashTxRow[]; onClose: () => void }) {
  type ReportType = "all" | "day" | "category" | "staff";
  const [type, setType] = useState<ReportType>("all");
  const [kindFilter, setKindFilter] = useState<""|"collection"|"expense">("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [staffFilter, setStaffFilter] = useState<string>("");
  const [range, setRange] = useState<RangeKey>("all");
  const initial = presetDates("today")!;
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [showInactive, setShowInactive] = useState(false);

  const onRangeChange = (k: RangeKey) => {
    setRange(k);
    const p = presetDates(k);
    if (p) { setFromDate(p.from); setToDate(p.to); }
  };

  const filtered = useMemo(() => tx.filter(t => {
    if (kindFilter && t.kind !== kindFilter) return false;
    if (categoryFilter && t.type_name !== categoryFilter) return false;
    if (staffFilter && t.staff_name !== staffFilter) return false;
    if (!showInactive && !t.active) return false;
    if (range !== "all") {
      const occ = new Date(t.occurred_at);
      const fromD = new Date(fromDate + "T00:00:00");
      const toD = new Date(toDate + "T23:59:59");
      if (occ < fromD || occ > toD) return false;
    }
    return true;
  }), [tx, kindFilter, categoryFilter, staffFilter, range, fromDate, toDate, showInactive]);

  // Filter-aware totals: Total In / Total Out / Net / Owner-paid
  const filteredTotals = useMemo(() => {
    let collected = 0, spent = 0, ownerPaid = 0;
    for (const t of filtered) {
      if (t.kind === "collection") collected += Number(t.amount);
      else {
        spent += Number(t.amount);
        if ((t.type_name || "").toLowerCase() === "handed over to owner") ownerPaid += Number(t.amount);
      }
    }
    return { collected, spent, balance: collected - spent, ownerPaid };
  }, [filtered]);

  const categories = Array.from(new Set(tx.map(t => t.type_name))).sort();
  const staffs = Array.from(new Set(tx.map(t => t.staff_name).filter(Boolean))) as string[];

  const grouped = useMemo(() => {
    if (type === "all") return null;
    const m = new Map<string, { collected: number; spent: number; count: number }>();
    for (const t of filtered) {
      let key = "";
      if (type === "day") key = new Date(t.occurred_at).toLocaleDateString("en-IN");
      else if (type === "category") key = t.type_name;
      else if (type === "staff") key = t.staff_name || "—";
      const cur = m.get(key) ?? { collected: 0, spent: 0, count: 0 };
      if (t.kind === "collection") cur.collected += Number(t.amount); else cur.spent += Number(t.amount);
      cur.count += 1;
      m.set(key, cur);
    }
    return Array.from(m.entries()).map(([k, v]) => ({ key: k, ...v, net: v.collected - v.spent }));
  }, [filtered, type]);

  const onExportExcel = () => {
    if (type === "all") {
      if (filtered.length === 0) { toast.error("No transactions"); return; }
      downloadCSV(`cash-report-all-${toLocalYMD()}.csv`,
        filtered.map(t => ({
          Date: new Date(t.occurred_at).toLocaleString("en-IN"),
          Kind: t.kind === "collection" ? "In" : "Out",
          Category: t.type_name, "Other Type": t.description ?? "",
          Guest: t.guest_name ?? "", Mobile: t.guest_mobile ?? "", Room: t.room_number ?? "",
          Staff: t.staff_name ?? "", Amount: Number(t.amount), Notes: t.notes ?? "",
          Active: t.active ? "Yes" : "No",
        })));
    } else if (grouped) {
      if (grouped.length === 0) { toast.error("No data"); return; }
      const label = type === "day" ? "Date" : type === "category" ? "Category" : "Entered By";
      downloadCSV(`cash-report-${type}-${toLocalYMD()}.csv`,
        grouped.map(g => ({ [label]: g.key, Collected: g.collected, Spent: g.spent, Net: g.net, Count: g.count })));
    }
    toast.success("Exported");
  };

  // -------- Copy WhatsApp-friendly report --------
  const buildWhatsAppReport = () => {
    const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
    const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const period = range === "all"
      ? "All time"
      : `${fmtDate(fromDate)} - ${fmtDate(toDate)}`;

    // Opening balance = net cash before fromDate (only meaningful when a date range is set)
    let opening = 0;
    if (range !== "all") {
      const fromD = new Date(fromDate + "T00:00:00");
      for (const t of tx) {
        if (!t.active) continue;
        if (new Date(t.occurred_at) < fromD) opening += t.kind === "collection" ? Number(t.amount) : -Number(t.amount);
      }
    }

    // Group filtered rows by category respecting kindFilter
    const incomeBy = new Map<string, number>();
    const expenseBy = new Map<string, number>();
    for (const t of filtered) {
      if (t.kind === "collection") incomeBy.set(t.type_name, (incomeBy.get(t.type_name) ?? 0) + Number(t.amount));
      else expenseBy.set(t.type_name, (expenseBy.get(t.type_name) ?? 0) + Number(t.amount));
    }

    const lines: string[] = [];
    lines.push("CASH REPORT");
    lines.push(`Period: ${period}`);
    if (categoryFilter) lines.push(`Category: ${categoryFilter}`);
    if (staffFilter) lines.push(`Entered By: ${staffFilter}`);
    lines.push("");
    if (range !== "all") {
      lines.push(`Opening Balance: ${inr(opening)}`);
      lines.push("");
    }

    const showIncome = kindFilter !== "expense";
    const showExpense = kindFilter !== "collection";

    if (showIncome) {
      lines.push("*Income*");
      if (incomeBy.size === 0) lines.push("  None");
      else for (const [k, v] of [...incomeBy.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${k} - ${inr(v)}`);
      }
      lines.push(`Total Income: ${inr(filteredTotals.collected)}`);
      lines.push("");
    }
    if (showExpense) {
      lines.push("*Expenses*");
      if (expenseBy.size === 0) lines.push("  None");
      else for (const [k, v] of [...expenseBy.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${k} - ${inr(v)}`);
      }
      lines.push(`Total Expense: ${inr(filteredTotals.spent)}`);
      lines.push("");
    }

    if (range !== "all" && showIncome && showExpense) {
      const closing = opening + filteredTotals.collected - filteredTotals.spent;
      lines.push(`Closing Balance: ${inr(closing)}`);
    } else if (showIncome && showExpense) {
      lines.push(`Net: ${inr(filteredTotals.balance)}`);
    }

    return lines.join("\n");
  };

  const onCopyReport = async () => {
    try {
      const text = buildWhatsAppReport();
      await navigator.clipboard.writeText(text);
      toast.success("Report copied — paste into WhatsApp");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not copy");
    }
  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="luxe-card rounded-xl w-full max-w-4xl p-5 space-y-4 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl">📊 Cash Reports</h3>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Report Type</label>
            <select className={inputCls} value={type} onChange={e=>setType(e.target.value as ReportType)}>
              <option value="all">All Transactions</option>
              <option value="day">Day-wise Summary</option>
              <option value="category">Category-wise Summary</option>
              <option value="staff">Entered By Summary</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Date Range</label>
            <select className={cn(inputCls,"!py-2")} value={range} onChange={e=>onRangeChange(e.target.value as RangeKey)}>
              {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {range !== "all" && (
            <>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">From</label>
                <input type="date" className={cn(inputCls,"!py-2")} value={fromDate} onChange={e=>setFromDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">To</label>
                <input type="date" className={cn(inputCls,"!py-2")} value={toDate} onChange={e=>setToDate(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Transaction Type</label>
            <select className={inputCls} value={kindFilter} onChange={e=>setKindFilter(e.target.value as any)}>
              <option value="">All</option><option value="collection">Collections</option><option value="expense">Expenses</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Category</label>
            <select className={inputCls} value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}>
              <option value="">All</option>
              {categories.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Entered By</label>
            <select className={inputCls} value={staffFilter} onChange={e=>setStaffFilter(e.target.value)}>
              <option value="">All</option>
              {staffs.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground self-end pb-2">
            <input type="checkbox" checked={showInactive} onChange={e=>setShowInactive(e.target.checked)} />
            Show Inactive
          </label>
        </div>


        {/* Filter-aware totals — Total In / Total Out / Net / Owner-Paid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total In</div>
            <div className="text-sm font-medium text-success tabular-nums">₹{filteredTotals.collected.toLocaleString("en-IN")}</div>
          </div>
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Out</div>
            <div className="text-sm font-medium text-destructive tabular-nums">₹{filteredTotals.spent.toLocaleString("en-IN")}</div>
          </div>
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Net</div>
            <div className="text-sm font-medium gold-text-gradient tabular-nums">₹{filteredTotals.balance.toLocaleString("en-IN")}</div>
          </div>
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Paid to Owner</div>
            <div className="text-sm font-medium gold-text-gradient tabular-nums">₹{filteredTotals.ownerPaid.toLocaleString("en-IN")}</div>
          </div>
        </div>

        <div className="rounded-md border border-border overflow-x-auto">
          {type === "all" ? (
            <table className="w-full text-sm min-w-[820px]">
              <thead className="text-[10px] uppercase text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Kind</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-left">Other Type</th>
                  <th className="px-3 py-2 text-left">Staff</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={7} className="text-center text-muted-foreground py-6">No transactions</td></tr>}
                {filtered.map(t => (
                  <tr key={t.id} className="border-b border-border/60">
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(t.occurred_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="px-3 py-2">{t.kind === "collection" ? "In" : "Out"}</td>
                    <td className="px-3 py-2">{t.type_name}</td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground max-w-[180px] truncate" title={t.description ?? ""}>
                      {t.description && t.description.trim() ? t.description : "—"}
                    </td>
                    <td className="px-3 py-2">{t.staff_name ?? "—"}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", t.kind === "collection" ? "text-success" : "text-destructive")}>₹{Number(t.amount).toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground max-w-[200px] truncate" title={t.notes ?? ""}>
                      {t.notes && t.notes.trim() ? t.notes : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

          ) : (
            <table className="w-full text-sm min-w-[560px]">
              <thead className="text-[10px] uppercase text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-3 py-2 text-left">{type === "day" ? "Date" : type === "category" ? "Category" : "Entered By"}</th>
                  <th className="px-3 py-2 text-right">Collected</th>
                  <th className="px-3 py-2 text-right">Spent</th>
                  <th className="px-3 py-2 text-right">Net</th>
                  <th className="px-3 py-2 text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {(grouped ?? []).length === 0 && <tr><td colSpan={5} className="text-center text-muted-foreground py-6">No data</td></tr>}
                {(grouped ?? []).map(g => (
                  <tr key={g.key} className="border-b border-border/60">
                    <td className="px-3 py-2">{g.key}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-success">₹{g.collected.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-destructive">₹{g.spent.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">₹{g.net.toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{g.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={onExportExcel}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm hover:border-gold/40">
            <Download className="h-4 w-4 text-gold" /> Export CSV
          </button>
          <button onClick={() => {
              try {
                if (filtered.length === 0 && !(grouped && grouped.length)) {
                  toast.error("Nothing to print for the current filters");
                  return;
                }
                let opening: number | null = null;
                if (range !== "all") {
                  const fromD = new Date(fromDate + "T00:00:00");
                  opening = 0;
                  for (const t of tx) {
                    if (!t.active) continue;
                    if (new Date(t.occurred_at) < fromD) opening += t.kind === "collection" ? Number(t.amount) : -Number(t.amount);
                  }
                }
                const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
                const periodLabel = range === "all" ? "All Time" : `${fmtDate(fromDate)} – ${fmtDate(toDate)}`;
                const groupLabel = type === "day" ? "Date" : type === "category" ? "Category" : type === "staff" ? "Entered By" : null;
                printCashReport({
                  rows: filtered,
                  grouped: type === "all" ? null : (grouped ?? []),
                  groupLabel: groupLabel as any,
                  totals: filteredTotals,
                  opening,
                  periodLabel,
                  filters: { kind: kindFilter || undefined, category: categoryFilter || undefined, staff: staffFilter || undefined },
                  showInactive,
                });
              } catch (e: any) {
                toast.error(e?.message ?? "Could not print");
              }
            }}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm hover:border-gold/40">
            <Printer className="h-4 w-4 text-gold" /> Print / PDF
          </button>
          <button onClick={onCopyReport}
            className="inline-flex items-center gap-2 rounded-md gold-gradient text-charcoal px-4 py-2 text-sm font-medium">
            <ClipboardCopy className="h-4 w-4" /> Copy Report
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================== AUDIT CLOSE ==============================
function AuditClosePanel() {
  const qc = useQueryClient();
  const { data: active } = useQuery({ queryKey: ["cash-audit-active"], queryFn: getActiveAuditClose });
  const { data: history = [] } = useQuery({ queryKey: ["cash-audit-history"], queryFn: listCashAuditCloses });
  const { data: activities = [] } = useQuery({ queryKey: ["cash-audit-activities"], queryFn: listCashAuditActivities });

  const [closeDate, setCloseDate] = useState<string>(toLocalYMD());
  const [reopenId, setReopenId] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");

  const closeMut = useMutation({
    mutationFn: () => createCashAuditClose(closeDate),
    onSuccess: () => {
      toast.success("Audit closed");
      qc.invalidateQueries({ queryKey: ["cash-audit-active"] });
      qc.invalidateQueries({ queryKey: ["cash-audit-history"] });
      qc.invalidateQueries({ queryKey: ["cash-audit-activities"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const reopenMut = useMutation({
    mutationFn: () => reopenCashAuditClose(reopenId!, reopenReason),
    onSuccess: () => {
      toast.success("Audit reopened");
      setReopenId(null); setReopenReason("");
      qc.invalidateQueries({ queryKey: ["cash-audit-active"] });
      qc.invalidateQueries({ queryKey: ["cash-audit-history"] });
      qc.invalidateQueries({ queryKey: ["cash-audit-activities"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="luxe-card rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-display text-lg">Audit Close</h3>
            <p className="text-xs text-muted-foreground">Lock cashbook transactions on or before a chosen date. Staff and Owner cannot edit or delete locked rows. Admin can reopen with a mandatory reason.</p>
          </div>
        </div>
        {active ? (
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border border-warning/40 bg-warning/10 px-3 py-3">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-warning" />
              <span className="text-sm">Locked through <strong>{active.closed_through_date}</strong> · by {active.closed_by_name ?? "—"} on {new Date(active.closed_at).toLocaleString("en-IN")}</span>
            </div>
            <button onClick={() => setReopenId(active.id)}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-1.5 text-xs">
              <Unlock className="h-3.5 w-3.5" /> Unlock
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap rounded-md border border-border bg-card px-3 py-3">
            <span className="text-xs text-muted-foreground">Close through:</span>
            <input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)}
              className="bg-input/60 border border-border rounded-md px-3 py-1.5 text-sm" />
            <button onClick={() => { if (confirm(`Audit close all transactions on or before ${closeDate}?`)) closeMut.mutate(); }}
              disabled={closeMut.isPending}
              className="inline-flex items-center gap-1.5 gold-gradient text-charcoal rounded-md px-4 py-1.5 text-xs font-medium disabled:opacity-60">
              <Lock className="h-3.5 w-3.5" /> Audit Close
            </button>
          </div>
        )}
      </div>

      <div className="luxe-card rounded-xl p-5">
        <h4 className="font-display text-base mb-3">Close History</h4>
        {history.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground text-center">No audit closes yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-2 py-2">Through</th>
                  <th className="px-2 py-2">State</th>
                  <th className="px-2 py-2">Closed By</th>
                  <th className="px-2 py-2">Closed At</th>
                  <th className="px-2 py-2">Reopened</th>
                  <th className="px-2 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-border/60">
                    <td className="px-2 py-2">{h.closed_through_date}</td>
                    <td className="px-2 py-2">
                      {h.active ? (
                        <span className="text-[10px] uppercase rounded-full px-2 py-0.5 bg-warning/15 text-warning border border-warning/40">🔒 Audited</span>
                      ) : (
                        <span className="text-[10px] uppercase rounded-full px-2 py-0.5 bg-muted/60 text-muted-foreground border border-border">🔓 Reopened</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-[11px]">{h.closed_by_name ?? "—"}</td>
                    <td className="px-2 py-2 text-[11px] text-muted-foreground">{new Date(h.closed_at).toLocaleString("en-IN")}</td>
                    <td className="px-2 py-2 text-[11px] text-muted-foreground">
                      {h.reopened_at ? `${h.reopened_by_name ?? "—"} · ${new Date(h.reopened_at).toLocaleString("en-IN")}` : "—"}
                    </td>
                    <td className="px-2 py-2 text-[11px] text-muted-foreground">{h.reopen_reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="luxe-card rounded-xl p-5">
        <h4 className="font-display text-base mb-3">Activity Log</h4>
        {activities.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground text-center">No activity yet.</div>
        ) : (
          <div className="space-y-2">
            {activities.map((a) => (
              <div key={a.id} className="flex items-start gap-3 text-xs border-b border-border/60 pb-2">
                <div className="text-muted-foreground whitespace-nowrap">{new Date(a.created_at).toLocaleString("en-IN")}</div>
                <div className="flex-1">
                  <div>{a.summary}</div>
                  <div className="text-[10px] text-muted-foreground">{a.actor_name ?? "—"} ({a.actor_role ?? "—"})</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {reopenId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setReopenId(null)}>
          <div className="luxe-card rounded-xl p-5 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg">Reopen Audit</h3>
            <p className="text-xs text-muted-foreground">Provide a reason — this is logged in the activity history.</p>
            <textarea className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm min-h-[100px]"
              value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="e.g. Correction for misposted expense on 12-Jun" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setReopenId(null)} className="px-4 py-2 text-xs text-muted-foreground">Cancel</button>
              <button onClick={() => reopenMut.mutate()} disabled={!reopenReason.trim() || reopenMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive/15 text-destructive border border-destructive/40 px-4 py-2 text-xs font-medium disabled:opacity-60">
                <Unlock className="h-3.5 w-3.5" /> Reopen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
