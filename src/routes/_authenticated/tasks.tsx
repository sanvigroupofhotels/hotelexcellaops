import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { listTasks, createTask, completeTask, deleteTask } from "@/lib/tasks-api";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import { TASK_TYPES, TASK_PRIORITIES, taskPriorityStyles } from "@/lib/mock-data";
import { CheckCircle2, Loader2, Plus, Trash2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/tasks")({
  component: TasksPage,
});

function TasksPage() {
  const qc = useQueryClient();
  useRealtimeInvalidate(["tasks"], ["tasks"], "tasks");
  const { data: tasks = [], isLoading } = useQuery({ queryKey: ["tasks"], queryFn: listTasks });
  const [tab, setTab] = useState<"today" | "upcoming" | "overdue" | "done">("today");
  const [form, setForm] = useState({ title: "", type: "Follow-up", priority: "Medium", due_date: new Date().toISOString().slice(0, 10), notes: "" });

  const create = useMutation({
    mutationFn: () => createTask(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success("Task created"); setForm({ ...form, title: "", notes: "" }); },
    onError: (e: any) => toast.error(e.message),
  });
  const done = useMutation({
    mutationFn: completeTask,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success("Marked done"); },
  });
  const del = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success("Deleted"); },
  });

  const today = new Date().toISOString().slice(0, 10);
  const filtered = tasks.filter((t) => {
    if (tab === "done") return t.status === "Done";
    if (t.status === "Done") return false;
    if (tab === "overdue") return t.due_date && t.due_date < today;
    if (tab === "today") return t.due_date === today;
    if (tab === "upcoming") return !t.due_date || t.due_date > today;
    return true;
  });

  return (
    <>
      <Topbar title="Tasks" subtitle="Follow-ups, negotiations, and operational work" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-5 max-w-[1400px]">
        <div className="luxe-card rounded-xl p-5">
          <h3 className="font-display text-lg mb-3">New Task</h3>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <input className="md:col-span-4 bg-input/60 border border-border rounded-md px-3 py-2 text-sm" placeholder="Task title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <select className="md:col-span-2 bg-input/60 border border-border rounded-md px-3 py-2 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TASK_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select className="md:col-span-2 bg-input/60 border border-border rounded-md px-3 py-2 text-sm" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </select>
            <input type="date" className="md:col-span-2 bg-input/60 border border-border rounded-md px-3 py-2 text-sm" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            <button onClick={() => { if (!form.title.trim()) return toast.error("Title required"); create.mutate(); }}
              disabled={create.isPending}
              className="md:col-span-2 inline-flex items-center justify-center gap-2 rounded-md gold-gradient px-4 py-2 text-sm font-medium text-charcoal disabled:opacity-60">
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["today", "overdue", "upcoming", "done"] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn("whitespace-nowrap px-3.5 py-1.5 rounded-full text-xs border capitalize",
                tab === k ? "border-gold/50 bg-gold-soft text-gold" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
              {k}
            </button>
          ))}
        </div>

        <div className="luxe-card rounded-xl overflow-hidden">
          {isLoading && <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>}
          {!isLoading && filtered.length === 0 && <div className="py-16 text-center text-sm text-muted-foreground">No tasks here.</div>}
          {filtered.map((t, i) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
              className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-3 px-4 md:px-6 py-3 border-b border-border/60 last:border-0 hover:bg-secondary/40">
              <div className="md:col-span-5">
                <div className={cn("text-sm font-medium", t.status === "Done" && "line-through text-muted-foreground")}>{t.title}</div>
                {t.notes && <div className="text-[11px] text-muted-foreground mt-0.5">{t.notes}</div>}
              </div>
              <div className="md:col-span-2 text-xs text-muted-foreground">{t.type}</div>
              <div className="md:col-span-2">
                <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]", taskPriorityStyles[t.priority])}>{t.priority}</span>
              </div>
              <div className="md:col-span-2 text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />{t.due_date ?? "—"}
              </div>
              <div className="md:col-span-1 flex items-center justify-end gap-1">
                {t.status !== "Done" && (
                  <button onClick={() => done.mutate(t.id)} className="p-1.5 rounded text-muted-foreground hover:text-success hover:bg-success/10" title="Mark done">
                    <CheckCircle2 className="h-4 w-4" />
                  </button>
                )}
                <button onClick={() => { if (confirm("Delete task?")) del.mutate(t.id); }} className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </>
  );
}
