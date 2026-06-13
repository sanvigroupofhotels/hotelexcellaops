import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, ChevronLeft, ChevronRight, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  listAttendance, upsertAttendance, bulkMarkPresent, deleteAttendance,
  type AttendanceStatus, listStaffHr, monthRange, monthKey,
} from "@/lib/staff-hr-api";
import { useUserRole } from "@/hooks/use-role";

export const Route = createFileRoute("/_authenticated/attendance")({ component: AttendancePage });

const STATUS_CYCLE: (AttendanceStatus | null)[] = [null, "Present", "Absent", "HalfDay", "Leave"];
const STATUS_GLYPH: Record<AttendanceStatus, string> = { Present: "P", Absent: "A", HalfDay: "H", Leave: "L" };
const STATUS_COLOR: Record<AttendanceStatus, string> = {
  Present: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  Absent: "bg-red-500/20 text-red-300 border-red-500/40",
  HalfDay: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  Leave: "bg-sky-500/20 text-sky-300 border-sky-500/40",
};

function AttendancePage() {
  const qc = useQueryClient();
  const { isAdmin } = useUserRole();
  const [monthDate, setMonthDate] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const month = monthKey(monthDate);
  const range = monthRange(month);
  const numDays = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  const { data: staff = [] } = useQuery({ queryKey: ["staff-hr-active"], queryFn: () => listStaffHr(true) });
  const { data: att = [] } = useQuery({
    queryKey: ["attendance", range.from, range.to],
    queryFn: () => listAttendance({ from: range.from, to: range.to }),
  });

  const map = useMemo(() => {
    const m = new Map<string, AttendanceStatus>();
    for (const a of att) m.set(`${a.staff_id}|${a.date}`, a.status);
    return m;
  }, [att]);

  const setStatus = useMutation({
    mutationFn: async (input: { staff_id: string; date: string; current: AttendanceStatus | undefined }) => {
      const idx = STATUS_CYCLE.indexOf(input.current ?? null);
      const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
      if (next === null) await deleteAttendance(input.staff_id, input.date);
      else await upsertAttendance({ staff_id: input.staff_id, date: input.date, status: next });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const markAllToday = useMutation({
    mutationFn: () => bulkMarkPresent(staff.map((s) => s.id), today),
    onSuccess: () => { toast.success("Marked Present for today"); qc.invalidateQueries({ queryKey: ["attendance"] }); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const days = Array.from({ length: numDays }, (_, i) => i + 1);

  function shiftMonth(delta: number) {
    const d = new Date(monthDate); d.setMonth(d.getMonth() + delta); d.setDate(1); setMonthDate(d);
  }

  // Per-staff summary
  function summary(staffId: string) {
    let p = 0, a = 0, h = 0, l = 0;
    for (const day of days) {
      const dstr = `${month}-${String(day).padStart(2, "0")}`;
      const s = map.get(`${staffId}|${dstr}`);
      if (s === "Present") p++; else if (s === "Absent") a++; else if (s === "HalfDay") h++; else if (s === "Leave") l++;
    }
    return { p, a, h, l };
  }

  return (
    <div className="min-h-screen">
      <Topbar title="Staff Attendance" subtitle="Tap a cell to cycle P → A → H → L → clear" />
      <main className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => shiftMonth(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-gold" />
              <span className="font-display text-xl">
                {monthDate.toLocaleString(undefined, { month: "long", year: "numeric" })}
              </span>
            </div>
            <Button variant="ghost" size="icon" onClick={() => shiftMonth(1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          {isAdmin && (
            <Button onClick={() => markAllToday.mutate()} disabled={markAllToday.isPending}>
              <CheckCheck className="h-4 w-4" /> Mark all Present (today)
            </Button>
          )}
        </div>

        <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
          {(["Present", "Absent", "HalfDay", "Leave"] as AttendanceStatus[]).map((s) => (
            <span key={s} className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded border", STATUS_COLOR[s])}>
              <span className="font-bold">{STATUS_GLYPH[s]}</span> {s}
            </span>
          ))}
        </div>

        <div className="rounded-md border border-border overflow-x-auto bg-card">
          <table className="text-xs min-w-max">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border">
                <th className="sticky left-0 bg-card text-left px-2 py-2 min-w-[180px] z-10">Employee</th>
                {days.map((d) => {
                  const dstr = `${month}-${String(d).padStart(2, "0")}`;
                  const isToday = dstr === today;
                  return (
                    <th key={d} className={cn("text-center px-1 py-2 w-8", isToday && "text-gold font-bold")}>{d}</th>
                  );
                })}
                <th className="text-center px-2 py-2 min-w-[140px]">P/A/H/L</th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 && (
                <tr><td colSpan={numDays + 2} className="text-center text-muted-foreground py-8">No active staff. Add staff in Staff Master.</td></tr>
              )}
              {staff.map((s) => {
                const sum = summary(s.id);
                return (
                  <tr key={s.id} className="border-b border-border/50">
                    <td className="sticky left-0 bg-card px-2 py-1.5 font-medium z-10">
                      <div>{s.name}</div>
                      <div className="text-[10px] text-muted-foreground">{s.designation ?? ""}</div>
                    </td>
                    {days.map((d) => {
                      const dstr = `${month}-${String(d).padStart(2, "0")}`;
                      const status = map.get(`${s.id}|${dstr}`);
                      const isFuture = dstr > today;
                      return (
                        <td key={d} className="text-center p-0.5">
                          <button
                            disabled={!isAdmin || isFuture}
                            onClick={() => setStatus.mutate({ staff_id: s.id, date: dstr, current: status })}
                            className={cn(
                              "w-7 h-7 rounded text-[11px] font-bold border transition",
                              status ? STATUS_COLOR[status] : "border-border/40 text-muted-foreground/40 hover:border-gold/40",
                              isFuture && "opacity-30 cursor-not-allowed",
                            )}
                          >
                            {status ? STATUS_GLYPH[status] : "·"}
                          </button>
                        </td>
                      );
                    })}
                    <td className="text-center px-2 py-1.5 text-[11px] font-mono">
                      <span className="text-emerald-400">{sum.p}</span>/
                      <span className="text-red-400">{sum.a}</span>/
                      <span className="text-amber-400">{sum.h}</span>/
                      <span className="text-sky-400">{sum.l}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
