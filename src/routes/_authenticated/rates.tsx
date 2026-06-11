import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { AdminOnly } from "@/components/admin-only";
import { listRoomRates, upsertRoomRate, listRateOverrides, upsertRateOverride, deleteRateOverride, bulkApplyOverrides } from "@/lib/rates-api";
import { roomTypes } from "@/lib/mock-data";
import { resolveRate, isWeekend } from "@/lib/rates";
import { ChevronLeft, ChevronRight, Loader2, Settings2, Calendar as CalendarIcon, X, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/rates")({ component: RatesPage });

const inputCls = "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50";

function monthKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
// Use LOCAL date components — d.toISOString() shifts to UTC and produces the
// previous day in IST (UTC+5:30), causing the rates grid to look one day
// shifted vs. what the user picked in the bulk dialog (15→16 became 16→17).
function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function RatesPage() {
  return (
    <AdminOnly>
      <Topbar title="Rates & Inventory" subtitle="Manage room rates and date-specific overrides" />
      <RatesContent />
    </AdminOnly>
  );
}

function RatesContent() {
  const qc = useQueryClient();
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [defaultsFor, setDefaultsFor] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editCell, setEditCell] = useState<{ room_type: string; date: string } | null>(null);

  const year = cursor.getFullYear(); const month = cursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1));
  const monthStart = dateKey(new Date(year, month, 1));
  const monthEnd = dateKey(new Date(year, month, daysInMonth));

  const { data: rates = [], isLoading: lr } = useQuery({ queryKey: ["room-rates"], queryFn: listRoomRates });
  const { data: overrides = [], isLoading: lo } = useQuery({
    queryKey: ["rate-overrides", monthStart, monthEnd],
    queryFn: () => listRateOverrides({ from: monthStart, to: monthEnd }),
  });
  const loading = lr || lo;

  const monthLabel = cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const rateByRoom = useMemo(() => {
    const m: Record<string, any> = {};
    for (const r of rates) m[r.room_type] = r;
    return m;
  }, [rates]);

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1600px] space-y-6">
      <div className="luxe-card rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="p-2 rounded-md border border-border hover:border-gold/40"><ChevronLeft className="h-4 w-4" /></button>
          <div className="font-display text-lg w-44 text-center">{monthLabel}</div>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="p-2 rounded-md border border-border hover:border-gold/40"><ChevronRight className="h-4 w-4" /></button>
          <button onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }} className="px-3 py-1.5 rounded-md border border-border text-xs hover:border-gold/40">Today</button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setBulkOpen(true)} className="inline-flex items-center gap-1.5 rounded-md border border-gold/40 bg-gold-soft text-gold px-3 py-1.5 text-xs hover:bg-gold/20">
            <CalendarIcon className="h-3.5 w-3.5" /> Bulk Apply
          </button>
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground">
        Priority: <span className="text-gold">Date Override</span> → Weekend / Weekday → Default
      </div>

      {loading ? (
        <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : (
        <div className="luxe-card rounded-xl p-0 overflow-x-auto">
          <table className="border-separate border-spacing-0 min-w-fit">
            <thead>
              <tr>
              <th className="sticky left-0 z-20 bg-card border-b-2 border-r-2 border-border px-3 py-2 text-[10px] uppercase tracking-wider text-left text-muted-foreground" style={{ minWidth: 160 }}>Room Type</th>
                {days.map((d, i) => {
                  const wk = isWeekend(dateKey(d));
                  return (
                    <th key={d.toISOString()} className={cn(
                      "border-b-2 border-r border-border px-1.5 py-2 text-[10px] uppercase tracking-wider text-center min-w-[64px]",
                      wk ? "text-gold bg-muted/50" : "text-muted-foreground",
                      i === days.length - 1 && "border-r-0",
                    )}>
                      <div>{d.toLocaleDateString("en-IN", { weekday: "short" })}</div>
                      <div className="text-foreground text-xs">{d.getDate()}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {roomTypes.map((rt) => {
                const cfg = rateByRoom[rt.name];
                return (
                  <tr key={rt.name}>
                    <td className="sticky left-0 z-10 bg-card border-b border-r-2 border-border px-3 py-2 text-xs align-top" style={{ minWidth: 160 }}>
                      <div className="font-medium">{rt.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        Def ₹{cfg?.default_rate ?? rt.rate}
                        {cfg?.weekday_rate != null && ` · Wk ₹${cfg.weekday_rate}`}
                        {cfg?.weekend_rate != null && ` · We ₹${cfg.weekend_rate}`}
                      </div>
                      <button onClick={() => setDefaultsFor(rt.name)} className="mt-1 inline-flex items-center gap-1 text-[10px] text-gold hover:underline">
                        <Settings2 className="h-3 w-3" /> Set Defaults
                      </button>
                    </td>
                    {days.map((d, i) => {
                      const dk = dateKey(d);
                      const ovr = overrides.find((o) => o.room_type === rt.name && o.date === dk);
                      const effective = resolveRate(rt.name, dk, rates, overrides) ?? rt.rate;
                      const wk = isWeekend(dk);
                      return (
                        <td key={dk} className={cn(
                          "border-b border-r border-border p-0.5 text-center",
                          wk && "bg-muted/40",
                          i === days.length - 1 && "border-r-0",
                        )}>
                          <button onClick={() => setEditCell({ room_type: rt.name, date: dk })}
                            className={cn("w-full px-1 py-1.5 text-[11px] rounded hover:ring-1 hover:ring-gold/40 tabular-nums",
                              ovr ? "bg-gold-soft text-gold font-medium" : "")}
                          >
                            ₹{effective.toLocaleString("en-IN")}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-gold-soft" /> Date Override</div>
        <div className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-muted/50 border border-border" /> Weekend (Fri / Sat)</div>
      </div>

      {defaultsFor && <DefaultsDialog room_type={defaultsFor} existing={rateByRoom[defaultsFor]} onClose={() => { setDefaultsFor(null); qc.invalidateQueries({ queryKey: ["room-rates"] }); }} />}
      {bulkOpen && <BulkDialog onClose={() => { setBulkOpen(false); qc.invalidateQueries({ queryKey: ["rate-overrides"] }); }} />}
      {editCell && <CellDialog cell={editCell} existing={overrides.find((o) => o.room_type === editCell.room_type && o.date === editCell.date)} onClose={() => { setEditCell(null); qc.invalidateQueries({ queryKey: ["rate-overrides"] }); }} />}
    </div>
  );
}

function DefaultsDialog({ room_type, existing, onClose }: { room_type: string; existing: any; onClose: () => void }) {
  const fallback = roomTypes.find((r) => r.name === room_type)?.rate ?? 0;
  // String state — lets users fully clear / backspace / type freely without fighting onChange parsing.
  const [def, setDef] = useState<string>(String(existing?.default_rate ?? fallback));
  const [wk, setWk] = useState<string>(existing?.weekday_rate != null ? String(existing.weekday_rate) : "");
  const [we, setWe] = useState<string>(existing?.weekend_rate != null ? String(existing.weekend_rate) : "");
  const save = useMutation({
    mutationFn: () => upsertRoomRate({
      room_type,
      default_rate: Number(def) || 0,
      weekday_rate: wk.trim() === "" ? null : Number(wk),
      weekend_rate: we.trim() === "" ? null : Number(we),
    }),
    onSuccess: () => { toast.success("Defaults saved"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog onClose={onClose} title={`Defaults · ${room_type}`}>
      <Field label="Default Rate (₹/night)">
        <input className={inputCls} type="number" inputMode="numeric" value={def} onChange={(e) => setDef(e.target.value)} />
      </Field>
      <Field label="Weekday Rate (Sun-Thu, optional)">
        <input className={inputCls} type="number" inputMode="numeric" value={wk} placeholder="Falls back to default" onChange={(e) => setWk(e.target.value)} />
      </Field>
      <Field label="Weekend Rate (Fri/Sat, optional)">
        <input className={inputCls} type="number" inputMode="numeric" value={we} placeholder="Falls back to default" onChange={(e) => setWe(e.target.value)} />
      </Field>
      <button onClick={() => save.mutate()} disabled={save.isPending} className="w-full gold-gradient text-charcoal rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60">
        {save.isPending ? "Saving…" : "Save Defaults"}
      </button>
    </Dialog>
  );
}

function BulkDialog({ onClose }: { onClose: () => void }) {
  const today = toLocalYMD();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [rate, setRate] = useState<string>("");
  // UAT: single room type only — picking Oak OR Maple, not both.
  const [roomType, setRoomType] = useState<string>(roomTypes[0].name);
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => bulkApplyOverrides({ room_type: roomType, from, to, rate: Number(rate) || 0, note }),
    onSuccess: () => { toast.success("Bulk overrides applied"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  // Inclusive day count for preview (string arithmetic to avoid TZ drift).
  const dayCount = (() => {
    if (!from || !to || to < from) return 0;
    const [y1, m1, d1] = from.split("-").map(Number);
    const [y2, m2, d2] = to.split("-").map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
  })();
  return (
    <Dialog onClose={onClose} title="Bulk Apply Rate">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="From"><input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {dayCount > 0 && (
        <div className="text-[11px] text-muted-foreground -mt-1">
          Will write <span className="text-gold">{dayCount}</span> day{dayCount === 1 ? "" : "s"} for {roomType}.
        </div>
      )}
      <Field label="Rate (₹/night)">
        <input type="number" inputMode="numeric" className={inputCls} value={rate} placeholder="e.g. 2500" onChange={(e) => setRate(e.target.value)} />
      </Field>
      <Field label="Room Type">
        <select className={inputCls} value={roomType} onChange={(e) => setRoomType(e.target.value)}>
          {roomTypes.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
        </select>
      </Field>
      <Field label="Note (optional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <button onClick={() => save.mutate()} disabled={save.isPending || !roomType || to < from || !rate} className="w-full gold-gradient text-charcoal rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60">
        {save.isPending ? "Applying…" : "Apply"}
      </button>
    </Dialog>
  );
}


function CellDialog({ cell, existing, onClose }: { cell: { room_type: string; date: string }; existing: any; onClose: () => void }) {
  const [rate, setRate] = useState<string>(existing?.rate != null ? String(existing.rate) : "");
  const [note, setNote] = useState(existing?.note ?? "");
  const save = useMutation({
    mutationFn: () => upsertRateOverride({ room_type: cell.room_type, date: cell.date, rate: Number(rate) || 0, note }),
    onSuccess: () => { toast.success("Override saved"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: () => deleteRateOverride(cell.room_type, cell.date),
    onSuccess: () => { toast.success("Override removed"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog onClose={onClose} title={`Override · ${cell.room_type} · ${cell.date}`}>
      <Field label="Rate (₹/night)">
        <input type="number" inputMode="numeric" autoFocus className={inputCls} value={rate} placeholder="Leave blank to inherit" onChange={(e) => setRate(e.target.value)} />
      </Field>
      <Field label="Note (optional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex gap-2">
        {existing && (
          <button onClick={() => del.mutate()} disabled={del.isPending} className="flex-1 rounded-md border border-destructive/40 text-destructive bg-destructive/10 px-3 py-2 text-xs font-medium disabled:opacity-60 inline-flex items-center justify-center gap-1.5">
            <Trash2 className="h-3 w-3" /> Remove
          </button>
        )}
        <button onClick={() => save.mutate()} disabled={save.isPending || !rate} className="flex-1 gold-gradient text-charcoal rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60">
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="luxe-card rounded-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h3 className="font-display text-lg">{title}</h3>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
