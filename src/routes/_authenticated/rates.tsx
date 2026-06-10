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
function dateKey(d: Date) { return d.toISOString().slice(0, 10); }

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
                <th className="sticky left-0 z-20 bg-card border-b-2 border-r-2 border-border px-3 py-2 text-[10px] uppercase tracking-wider text-left text-muted-foreground" style={{ minWidth: 180 }}>Room Type</th>
                {days.map((d) => {
                  const wk = isWeekend(dateKey(d));
                  return (
                    <th key={d.toISOString()} className={cn("border-b-2 border-border px-1.5 py-2 text-[10px] uppercase tracking-wider text-center min-w-[68px]", wk ? "text-gold bg-gold-soft/20" : "text-muted-foreground")}>
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
                    <td className="sticky left-0 z-10 bg-card border-b border-r-2 border-border px-3 py-2 text-xs align-top" style={{ minWidth: 180 }}>
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
                    {days.map((d) => {
                      const dk = dateKey(d);
                      const ovr = overrides.find((o) => o.room_type === rt.name && o.date === dk);
                      const effective = resolveRate(rt.name, dk, rates, overrides) ?? rt.rate;
                      return (
                        <td key={dk} className="border-b border-border p-0.5 text-center">
                          <button onClick={() => setEditCell({ room_type: rt.name, date: dk })}
                            className={cn("w-full px-1 py-1.5 text-[11px] rounded hover:ring-1 hover:ring-gold/40 tabular-nums",
                              ovr ? "bg-gold-soft text-gold font-medium" : isWeekend(dk) ? "bg-card/40" : "")}
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
        <div className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-card/40 border border-border" /> Weekend</div>
      </div>

      {defaultsFor && <DefaultsDialog room_type={defaultsFor} existing={rateByRoom[defaultsFor]} onClose={() => { setDefaultsFor(null); qc.invalidateQueries({ queryKey: ["room-rates"] }); }} />}
      {bulkOpen && <BulkDialog onClose={() => { setBulkOpen(false); qc.invalidateQueries({ queryKey: ["rate-overrides"] }); }} />}
      {editCell && <CellDialog cell={editCell} existing={overrides.find((o) => o.room_type === editCell.room_type && o.date === editCell.date)} onClose={() => { setEditCell(null); qc.invalidateQueries({ queryKey: ["rate-overrides"] }); }} />}
    </div>
  );
}

function DefaultsDialog({ room_type, existing, onClose }: { room_type: string; existing: any; onClose: () => void }) {
  const fallback = roomTypes.find((r) => r.name === room_type)?.rate ?? 0;
  const [def, setDef] = useState<number>(existing?.default_rate ?? fallback);
  const [wk, setWk] = useState<string>(existing?.weekday_rate?.toString() ?? "");
  const [we, setWe] = useState<string>(existing?.weekend_rate?.toString() ?? "");
  const save = useMutation({
    mutationFn: () => upsertRoomRate({
      room_type, default_rate: Number(def) || 0,
      weekday_rate: wk === "" ? null : Number(wk),
      weekend_rate: we === "" ? null : Number(we),
    }),
    onSuccess: () => { toast.success("Defaults saved"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog onClose={onClose} title={`Defaults · ${room_type}`}>
      <Field label="Default Rate (₹/night)"><input className={inputCls} type="number" value={def} onChange={(e) => setDef(Number(e.target.value))} /></Field>
      <Field label="Weekday Rate (optional)"><input className={inputCls} type="number" value={wk} placeholder="Falls back to default" onChange={(e) => setWk(e.target.value)} /></Field>
      <Field label="Weekend Rate (Sat/Sun, optional)"><input className={inputCls} type="number" value={we} placeholder="Falls back to default" onChange={(e) => setWe(e.target.value)} /></Field>
      <button onClick={() => save.mutate()} disabled={save.isPending} className="w-full gold-gradient text-charcoal rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60">
        {save.isPending ? "Saving…" : "Save Defaults"}
      </button>
    </Dialog>
  );
}

function BulkDialog({ onClose }: { onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [rate, setRate] = useState<number>(0);
  const [selected, setSelected] = useState<string[]>([roomTypes[0].name]);
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => bulkApplyOverrides({ room_types: selected, from, to, rate, note }),
    onSuccess: () => { toast.success("Bulk overrides applied"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  const toggle = (rt: string) => setSelected((s) => s.includes(rt) ? s.filter((x) => x !== rt) : [...s, rt]);
  return (
    <Dialog onClose={onClose} title="Bulk Apply Rate">
      <div className="grid grid-cols-2 gap-3">
        <Field label="From"><input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Field label="Rate (₹/night)"><input type="number" className={inputCls} value={rate} onChange={(e) => setRate(Number(e.target.value))} /></Field>
      <Field label="Room Types">
        <div className="flex flex-wrap gap-1.5">
          {roomTypes.map((r) => (
            <button key={r.name} type="button" onClick={() => toggle(r.name)}
              className={cn("text-[11px] rounded-md border px-2 py-1", selected.includes(r.name) ? "bg-gold-soft border-gold/60 text-gold" : "border-border text-muted-foreground hover:border-gold/40")}>
              {r.name}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Note (optional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <button onClick={() => save.mutate()} disabled={save.isPending || selected.length === 0 || to < from} className="w-full gold-gradient text-charcoal rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60">
        {save.isPending ? "Applying…" : "Apply"}
      </button>
    </Dialog>
  );
}

function CellDialog({ cell, existing, onClose }: { cell: { room_type: string; date: string }; existing: any; onClose: () => void }) {
  const [rate, setRate] = useState<number>(existing?.rate ?? 0);
  const [note, setNote] = useState(existing?.note ?? "");
  const save = useMutation({
    mutationFn: () => upsertRateOverride({ room_type: cell.room_type, date: cell.date, rate, note }),
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
      <Field label="Rate (₹/night)"><input type="number" className={inputCls} value={rate} onChange={(e) => setRate(Number(e.target.value))} /></Field>
      <Field label="Note (optional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex gap-2">
        {existing && (
          <button onClick={() => del.mutate()} disabled={del.isPending} className="flex-1 rounded-md border border-destructive/40 text-destructive bg-destructive/10 px-3 py-2 text-xs font-medium disabled:opacity-60 inline-flex items-center justify-center gap-1.5">
            <Trash2 className="h-3 w-3" /> Remove
          </button>
        )}
        <button onClick={() => save.mutate()} disabled={save.isPending} className="flex-1 gold-gradient text-charcoal rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60">
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
