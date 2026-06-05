import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { useUserRole } from "@/hooks/use-role";
import {
  listCashTx, createCashTx, softDeleteCashTx,
  listStaff, createStaff, updateStaff,
  listExpenseTypes, createExpenseType, updateExpenseType,
  COLLECTION_TYPES, type CashTxRow,
} from "@/lib/cash-api";
import { listBookings } from "@/lib/bookings-api";
import { toast } from "sonner";
import {
  Plus, Wallet, ArrowDownCircle, ArrowUpCircle, Loader2, Search, X,
  Users as UsersIcon, ListChecks, History as HistoryIcon, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/cash")({
  component: CashPage,
});

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

type RangeKey = "today" | "yesterday" | "week" | "month" | "custom";

function rangeBounds(key: RangeKey, customFrom?: string, customTo?: string) {
  const now = new Date();
  const start = new Date(now); start.setHours(0,0,0,0);
  const end = new Date(now); end.setHours(23,59,59,999);
  if (key === "today") return { from: start.toISOString(), to: end.toISOString() };
  if (key === "yesterday") {
    start.setDate(start.getDate()-1); end.setDate(end.getDate()-1);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  if (key === "week") {
    start.setDate(start.getDate() - start.getDay());
    return { from: start.toISOString(), to: end.toISOString() };
  }
  if (key === "month") {
    start.setDate(1);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  return {
    from: customFrom ? new Date(customFrom + "T00:00:00").toISOString() : undefined,
    to: customTo ? new Date(customTo + "T23:59:59").toISOString() : undefined,
  };
}

function CashPage() {
  const { isAdmin } = useUserRole();
  const [tab, setTab] = useState<"dashboard" | "staff" | "etypes">("dashboard");
  const [range, setRange] = useState<RangeKey>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [openForm, setOpenForm] = useState<null | "collection" | "expense">(null);

  const bounds = useMemo(() => rangeBounds(range, customFrom, customTo), [range, customFrom, customTo]);

  const { data: tx = [] } = useQuery({
    queryKey: ["cash-tx", bounds.from, bounds.to],
    queryFn: () => listCashTx(bounds),
  });

  const totals = useMemo(() => {
    let collected = 0, spent = 0;
    for (const t of tx) { if (t.kind === "collection") collected += Number(t.amount); else spent += Number(t.amount); }
    return { collected, spent, balance: collected - spent };
  }, [tx]);

  return (
    <>
      <Topbar title="Cash Management" subtitle="Track collections, expenses and current balance" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] pb-32 lg:pb-8 space-y-6">
        {/* Tabs */}
        <div className="flex items-center gap-2 border-b border-border overflow-x-auto">
          <TabBtn active={tab==="dashboard"} onClick={() => setTab("dashboard")} icon={HistoryIcon}>Dashboard</TabBtn>
          {isAdmin && <TabBtn active={tab==="staff"} onClick={() => setTab("staff")} icon={UsersIcon}>Staff Master</TabBtn>}
          {isAdmin && <TabBtn active={tab==="etypes"} onClick={() => setTab("etypes")} icon={ListChecks}>Expense Types</TabBtn>}
        </div>

        {tab === "dashboard" && (
          <>
            {/* Filter chips */}
            <div className="flex flex-wrap items-center gap-2">
              {(["today","yesterday","week","month","custom"] as RangeKey[]).map(k => (
                <button key={k} onClick={() => setRange(k)}
                  className={cn("px-3 py-1.5 text-xs rounded-full border transition",
                    range===k ? "bg-gold-soft border-gold/40 text-gold" : "border-border text-muted-foreground hover:text-foreground")}>
                  {k==="today"?"Today":k==="yesterday"?"Yesterday":k==="week"?"This Week":k==="month"?"This Month":"Custom"}
                </button>
              ))}
              {range==="custom" && (
                <div className="flex items-center gap-2 ml-2">
                  <input type="date" className={cn(inputCls,"!py-1.5 w-auto")} value={customFrom} onChange={e=>setCustomFrom(e.target.value)} />
                  <span className="text-muted-foreground text-xs">to</span>
                  <input type="date" className={cn(inputCls,"!py-1.5 w-auto")} value={customTo} onChange={e=>setCustomTo(e.target.value)} />
                </div>
              )}
            </div>

            {/* Top cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard label="Cash Collected" value={totals.collected} icon={ArrowDownCircle} tone="success" />
              <StatCard label="Cash Spent" value={totals.spent} icon={ArrowUpCircle} tone="danger" />
              <StatCard label="Current Balance" value={totals.balance} icon={Wallet} tone="gold" />
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <button onClick={()=>setOpenForm("collection")}
                className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2.5 text-sm font-medium text-charcoal">
                <Plus className="h-4 w-4"/> Add Cash Collection
              </button>
              <button onClick={()=>setOpenForm("expense")}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium hover:border-gold/40">
                <Plus className="h-4 w-4"/> Add Cash Expense
              </button>
            </div>

            <TransactionHistory tx={tx} isAdmin={isAdmin} />
          </>
        )}

        {tab === "staff" && isAdmin && <StaffMaster />}
        {tab === "etypes" && isAdmin && <ExpenseTypeMaster />}
      </div>

      {openForm && (
        <TxFormModal kind={openForm} onClose={()=>setOpenForm(null)} />
      )}
    </>
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

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: any; tone: "success"|"danger"|"gold" }) {
  const toneCls = tone==="success" ? "text-success" : tone==="danger" ? "text-destructive" : "gold-text-gradient";
  return (
    <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="luxe-card rounded-xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className={cn("h-4 w-4", toneCls)} />
      </div>
      <div className={cn("font-display text-3xl mt-2", toneCls)}>₹{Math.abs(value).toLocaleString("en-IN")}</div>
      {tone==="gold" && value < 0 && <div className="text-[10px] text-destructive mt-1">Negative — review entries</div>}
    </motion.div>
  );
}

// ---------- Transaction History ----------
function TransactionHistory({ tx, isAdmin }: { tx: CashTxRow[]; isAdmin: boolean }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<""|"collection"|"expense">("");
  const [type, setType] = useState("");
  const [staff, setStaff] = useState("");
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: softDeleteCashTx,
    onSuccess: () => { toast.success("Entry removed"); qc.invalidateQueries({ queryKey:["cash-tx"] }); },
    onError: (e: any) => toast.error(e.message),
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
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card flex-1 min-w-[180px]">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search…" className="bg-transparent outline-none text-sm flex-1" />
        </div>
        <select className={cn(inputCls,"w-auto")} value={kind} onChange={e=>setKind(e.target.value as any)}>
          <option value="">All Types</option><option value="collection">Collections</option><option value="expense">Expenses</option>
        </select>
        <select className={cn(inputCls,"w-auto")} value={type} onChange={e=>setType(e.target.value)}>
          <option value="">All Categories</option>
          {types.map(t => <option key={t}>{t}</option>)}
        </select>
        <select className={cn(inputCls,"w-auto")} value={staff} onChange={e=>setStaff(e.target.value)}>
          <option value="">All Staff</option>
          {staffs.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto -mx-4 md:mx-0">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
            <tr>
              <th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Category</th><th className="px-3 py-2">Guest</th>
              <th className="px-3 py-2">Booking/Room</th><th className="px-3 py-2">Staff</th>
              <th className="px-3 py-2 text-right">Amount</th>
              {isAdmin && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={isAdmin?8:7} className="text-center text-muted-foreground py-8">No transactions</td></tr>
            )}
            {filtered.map(t => (
              <tr key={t.id} className="border-b border-border/60 hover:bg-secondary/40">
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{new Date(t.occurred_at).toLocaleString("en-IN",{dateStyle:"short",timeStyle:"short"})}</td>
                <td className="px-3 py-2">
                  <span className={cn("text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5",
                    t.kind==="collection" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                    {t.kind==="collection"?"In":"Out"}
                  </span>
                </td>
                <td className="px-3 py-2">{t.type_name}{t.description ? <span className="block text-[10px] text-muted-foreground">{t.description}</span> : null}</td>
                <td className="px-3 py-2">
                  {t.guest_name ?? "—"}
                  {t.guest_mobile && <span className="block text-[10px] text-muted-foreground">{t.guest_mobile}</span>}
                </td>
                <td className="px-3 py-2 text-[11px]">
                  {t.booking_id ? <Link to="/bookings/$id" params={{id:t.booking_id}} className="text-gold hover:underline">Booking</Link> : "—"}
                  {t.room_number && <span className="block text-muted-foreground">Room {t.room_number}</span>}
                </td>
                <td className="px-3 py-2">{t.staff_name ?? "—"}</td>
                <td className={cn("px-3 py-2 text-right font-medium tabular-nums",
                  t.kind==="collection" ? "text-success" : "text-destructive")}>
                  {t.kind==="collection"?"+":"-"}₹{Number(t.amount).toLocaleString("en-IN")}
                </td>
                {isAdmin && (
                  <td className="px-3 py-2 text-right">
                    <button onClick={()=>{ if (confirm("Remove this entry?")) del.mutate(t.id); }}
                      className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4"/></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Tx Form Modal ----------
function TxFormModal({ kind, onClose, prefill }: { kind: "collection"|"expense"; onClose: ()=>void; prefill?: Partial<any> }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: staff = [] } = useQuery({ queryKey: ["staff","active"], queryFn: () => listStaff(true) });
  const { data: etypes = [] } = useQuery({ queryKey: ["etypes","active"], queryFn: () => listExpenseTypes(true) });
  const { data: bookings = [] } = useQuery({
    queryKey: ["bookings-cash-pick"],
    queryFn: listBookings,
    enabled: kind === "collection",
  });

  const [typeName, setTypeName] = useState<string>(
    prefill?.type_name ?? (kind === "collection" ? COLLECTION_TYPES[0] : (etypes[0]?.name ?? "")),
  );
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [guestName, setGuestName] = useState(prefill?.guest_name ?? "");
  const [guestMobile, setGuestMobile] = useState(prefill?.guest_mobile ?? "");
  const [roomNumber, setRoomNumber] = useState(prefill?.room_number ?? "");
  const [bookingId, setBookingId] = useState<string | null>(prefill?.booking_id ?? null);
  const [bookingSearch, setBookingSearch] = useState("");
  const [staffId, setStaffId] = useState<string>(prefill?.staff_id ?? "");
  const [amount, setAmount] = useState<number>(prefill?.amount ?? 0);
  const [notes, setNotes] = useState("");
  const [occurredAt, setOccurredAt] = useState<string>(() => {
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0,16);
  });

  const isOther = typeName === "Other" || typeName === "Others";
  const collectionMatchesETypes = kind==="expense" && etypes.length>0 && !typeName;
  // initialize expense type when list loads
  if (collectionMatchesETypes) setTypeName(etypes[0].name);

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

  const save = useMutation({
    mutationFn: () => createCashTx({
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
    }),
    onSuccess: () => {
      toast.success(kind==="collection" ? "Collection recorded" : "Expense recorded");
      qc.invalidateQueries({ queryKey: ["cash-tx"] });
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
          <h3 className="font-display text-lg">{kind==="collection"?"Add Cash Collection":"Add Cash Expense"}</h3>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-5 w-5"/></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Type */}
          <Field label={kind==="collection"?"Collection Type":"Expense Type"} required>
            <select className={inputCls} value={typeName} onChange={e=>setTypeName(e.target.value)}>
              {kind==="collection"
                ? COLLECTION_TYPES.map(t => <option key={t}>{t}</option>)
                : etypes.map(t => <option key={t.id}>{t.name}</option>)}
            </select>
          </Field>
          {isOther && (
            <Field label={kind==="collection"?"Description":"Expense Description"} required>
              <input className={inputCls} value={description} onChange={e=>setDescription(e.target.value)} />
            </Field>
          )}

          {/* Collection-only guest/booking fields */}
          {kind==="collection" && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Guest Name" required>
                  <input className={inputCls} value={guestName} onChange={e=>setGuestName(e.target.value)} />
                </Field>
                <Field label="Guest Mobile" required>
                  <input className={inputCls} inputMode="tel" value={guestMobile} onChange={e=>setGuestMobile(e.target.value)} />
                </Field>
              </div>
              <Field label="Room Number">
                <input className={inputCls} value={roomNumber} onChange={e=>setRoomNumber(e.target.value)} />
              </Field>
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
            <Field label="Amount (₹)" required>
              <input className={inputCls} type="number" min={0} step={1} value={amount || ""}
                onChange={e=>setAmount(Number(e.target.value))} />
            </Field>
          </div>

          <Field label="Notes">
            <textarea rows={2} className={cn(inputCls,"resize-none")} value={notes} onChange={e=>setNotes(e.target.value)} />
          </Field>
          <Field label="Date & Time">
            <input type="datetime-local" className={inputCls} value={occurredAt} onChange={e=>setOccurredAt(e.target.value)} />
          </Field>
        </div>
        <div className="sticky bottom-0 bg-card border-t border-border px-5 py-3 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-border">Cancel</button>
          <button onClick={()=>save.mutate()} disabled={save.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md gold-gradient text-charcoal font-medium disabled:opacity-60">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin"/>}
            Save
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
