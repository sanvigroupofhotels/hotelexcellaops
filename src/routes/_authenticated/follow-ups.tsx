import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Topbar } from "@/components/topbar";
import {
  listFollowups,
  completeFollowup,
  deleteFollowup,
  buildWhatsAppLink,
  logWhatsApp,
  addFollowup,
} from "@/lib/quotes-api";
import { useRealtimeInvalidate } from "@/hooks/use-realtime";
import {
  MessageCircle, Check, Trash2, Loader2, Clock, Phone, Mail,
  User as UserIcon, CalendarPlus, Plus, AlertOctagon, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/follow-ups")({
  component: FollowUps,
});

type FilterBucket = "due_today" | "overdue" | "upcoming" | "completed" | "all";

const BUCKET_LABEL: Record<FilterBucket, string> = {
  due_today: "Due Today",
  overdue: "Overdue",
  upcoming: "Upcoming",
  completed: "Completed",
  all: "All",
};

/**
 * Follow-ups Operational Workspace.
 *
 * Designed as the fallback destination for notifications that have no
 * deeper actionable entity. Reception staff should be able to call,
 * WhatsApp, email, open the customer/quote, add another follow-up, or
 * mark complete — without navigating elsewhere.
 */
function FollowUps() {
  const qc = useQueryClient();
  useRealtimeInvalidate(["followups", "quotes"], ["followups"], "followups");
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["followups"], queryFn: listFollowups });

  const [bucket, setBucket] = useState<FilterBucket>("due_today");
  const [search, setSearch] = useState("");

  const complete = useMutation({
    mutationFn: ({ id, quote_id }: { id: string; quote_id: string }) => completeFollowup(id, quote_id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["followups"] }); toast.success("Follow-up completed"); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to complete"),
  });
  const del = useMutation({
    mutationFn: deleteFollowup,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["followups"] }); toast.success("Follow-up removed"); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to remove"),
  });

  const now = Date.now();
  const startOfTomorrow = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); return d.getTime();
  }, []);

  const buckets = useMemo(() => {
    const counts = { due_today: 0, overdue: 0, upcoming: 0, completed: 0, all: rows.length };
    for (const f of rows as any[]) {
      const due = new Date(f.due_at).getTime();
      if (f.completed) counts.completed++;
      else if (due < now && due < startOfTomorrow) {
        // Anything not done by start-of-tomorrow is "due today or overdue"
        if (due < (new Date().setHours(0, 0, 0, 0))) counts.overdue++;
        else counts.due_today++;
      } else if (due >= now) counts.upcoming++;
    }
    // Operational rule: overdue rows ALSO surface under "Due Today" so reception
    // doesn't lose stragglers. Mirror that in the count.
    counts.due_today += counts.overdue;
    return counts;
  }, [rows, now, startOfTomorrow]);

  const visible = useMemo(() => {
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const q = search.trim().toLowerCase();
    return (rows as any[])
      .filter((f) => {
        const due = new Date(f.due_at).getTime();
        const overdue = !f.completed && due < startOfToday;
        const dueToday = !f.completed && due >= startOfToday && due < startOfTomorrow;
        const upcoming = !f.completed && due >= startOfTomorrow;
        switch (bucket) {
          case "due_today": return overdue || dueToday;
          case "overdue":   return overdue;
          case "upcoming":  return upcoming;
          case "completed": return f.completed;
          case "all":       return true;
        }
      })
      .filter((f) => {
        if (!q) return true;
        const qrow = f.quotes ?? {};
        return (
          (qrow.guest_name ?? "").toLowerCase().includes(q) ||
          (qrow.phone ?? "").toLowerCase().includes(q) ||
          (qrow.email ?? "").toLowerCase().includes(q) ||
          (qrow.reference_code ?? "").toLowerCase().includes(q) ||
          (qrow.lead_source ?? "").toLowerCase().includes(q) ||
          (f.note ?? "").toLowerCase().includes(q)
        );
      });
  }, [rows, bucket, search, startOfTomorrow]);

  return (
    <>
      <Topbar title="Follow-ups" subtitle="Operational workspace · call, message, convert" />
      <div className="px-4 md:px-8 py-5 md:py-7 space-y-4 max-w-[1200px]">
        {/* Bucket pills */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(BUCKET_LABEL) as FilterBucket[]).map((b) => (
              <button
                key={b}
                onClick={() => setBucket(b)}
                className={cn(
                  "px-3 py-1.5 rounded-md border text-xs transition",
                  bucket === b
                    ? "border-gold/60 bg-gold-soft/40 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                  b === "overdue" && (buckets as any).overdue > 0 && bucket !== b && "border-rose-500/30 text-rose-300",
                )}
              >
                {BUCKET_LABEL[b]} <span className="ml-1 tabular-nums opacity-75">{(buckets as any)[b] ?? 0}</span>
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, ref, source…"
            className="bg-input/60 border border-border rounded-md px-3 py-1.5 text-xs w-full sm:w-[260px] focus:outline-none focus:ring-2 focus:ring-gold/40"
          />
        </div>

        {isLoading && <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>}

        {!isLoading && visible.length === 0 && (
          <div className="luxe-card rounded-xl p-12 text-center text-sm text-muted-foreground">
            No follow-ups in <b>{BUCKET_LABEL[bucket]}</b>.{" "}
            {bucket !== "all" && <button className="text-gold hover:underline" onClick={() => setBucket("all")}>Show all</button>}
          </div>
        )}

        <AnimatePresence initial={false}>
          {visible.map((f: any, i: number) => (
            <FollowupCard
              key={f.id}
              f={f}
              index={i}
              onComplete={() => complete.mutate({ id: f.id, quote_id: f.quote_id })}
              onDelete={() => del.mutate(f.id)}
            />
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}

function FollowupCard({ f, index, onComplete, onDelete }: { f: any; index: number; onComplete: () => void; onDelete: () => void; }) {
  const qc = useQueryClient();
  const q = f.quotes ?? {};
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const due = new Date(f.due_at).getTime();
  const overdue = !f.completed && due < startOfToday;
  const dueToday = !f.completed && due >= startOfToday && due < startOfToday + 86400000;

  const phoneDigits = (q.phone ?? "").replace(/[^\d]/g, "");
  const waLink = q.guest_name ? buildWhatsAppLink(q) : null;

  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const snooze = useMutation({
    mutationFn: async (hours: number) => {
      const dueAt = new Date(Date.now() + hours * 3600_000).toISOString();
      return addFollowup(f.quote_id, dueAt, `Snoozed from ${new Date(f.due_at).toLocaleString("en-IN")}`);
    },
    onSuccess: async () => {
      // Complete the original so it doesn't double-up
      await completeFollowup(f.id, f.quote_id);
      qc.invalidateQueries({ queryKey: ["followups"] });
      toast.success("Follow-up rescheduled");
      setSnoozeOpen(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to snooze"),
  });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ delay: Math.min(index * 0.03, 0.2) }}
      className={cn(
        "luxe-card rounded-xl p-4 space-y-3",
        f.completed && "opacity-60",
        overdue && "border-rose-500/40",
        dueToday && !overdue && "border-gold/40",
      )}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className={cn(
            "h-10 w-10 rounded-md border flex items-center justify-center flex-shrink-0",
            overdue ? "bg-rose-500/15 border-rose-500/40" :
            dueToday ? "bg-gold-soft border-gold/40" :
            "bg-muted/30 border-border"
          )}>
            {overdue ? <AlertOctagon className="h-4 w-4 text-rose-400" /> : <Clock className="h-4 w-4 text-gold" />}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Link to="/quote/$id" params={{ id: f.quote_id }} className="font-medium text-sm hover:text-gold inline-flex items-center gap-1">
                {q.guest_name ?? "Unknown guest"} <ExternalLink className="h-3 w-3 opacity-60" />
              </Link>
              {q.reference_code && <span className="text-[10px] font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">{q.reference_code}</span>}
              {overdue && <span className="text-[10px] uppercase tracking-wider text-rose-400 font-medium">Overdue</span>}
              {dueToday && !overdue && <span className="text-[10px] uppercase tracking-wider text-gold font-medium">Due Today</span>}
              {q.status && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">· {q.status}</span>}
            </div>
            {/* Operational context strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {q.phone && <InfoCell label="Mobile" value={q.phone} />}
              {q.lead_source && <InfoCell label="Source" value={q.lead_source} />}
              {q.check_in && <InfoCell label="Check-In" value={new Date(q.check_in).toLocaleDateString("en-IN")} />}
              {q.check_out && <InfoCell label="Check-Out" value={new Date(q.check_out).toLocaleDateString("en-IN")} />}
              {q.email && <InfoCell label="Email" value={q.email} />}
              <InfoCell label="Due" value={new Date(f.due_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />
            </div>
            {f.note && <div className="text-[11px] text-foreground/80 italic">"{f.note}"</div>}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/40">
        {phoneDigits && (
          <a href={`tel:+${phoneDigits}`} className="action-btn">
            <Phone className="h-3.5 w-3.5 text-emerald-400" /> Call
          </a>
        )}
        {waLink && (
          <a
            href={waLink}
            target="_blank"
            rel="noreferrer"
            onClick={() => logWhatsApp(f.quote_id)}
            className="action-btn"
          >
            <MessageCircle className="h-3.5 w-3.5 text-success" /> WhatsApp
          </a>
        )}
        {q.email && (
          <a href={`mailto:${q.email}?subject=Hotel%20Excella%20—%20Your%20stay%20enquiry`} className="action-btn">
            <Mail className="h-3.5 w-3.5 text-sky-400" /> Email
          </a>
        )}
        {q.customer_id && (
          <Link to="/customers/$id" params={{ id: q.customer_id }} className="action-btn">
            <UserIcon className="h-3.5 w-3.5 text-gold" /> Customer
          </Link>
        )}
        <Link to="/quote/$id" params={{ id: f.quote_id }} className="action-btn">
          <Plus className="h-3.5 w-3.5 text-gold" /> Convert to Booking
        </Link>
        <div className="relative">
          <button onClick={() => setSnoozeOpen((v) => !v)} className="action-btn">
            <CalendarPlus className="h-3.5 w-3.5 text-amber-400" /> Snooze
          </button>
          {snoozeOpen && (
            <div className="absolute z-10 mt-1 right-0 rounded-md border border-border bg-card shadow-xl py-1 text-xs min-w-[140px]">
              {[
                { label: "+2 hours", h: 2 },
                { label: "Tomorrow", h: 24 },
                { label: "In 3 days", h: 72 },
                { label: "Next week", h: 168 },
              ].map((opt) => (
                <button
                  key={opt.h}
                  onClick={() => snooze.mutate(opt.h)}
                  disabled={snooze.isPending}
                  className="block w-full px-3 py-1.5 text-left hover:bg-muted/40"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1" />
        {!f.completed && (
          <button onClick={onComplete} className="action-btn border-gold/40">
            <Check className="h-3.5 w-3.5 text-gold" /> Mark complete
          </button>
        )}
        <button
          onClick={onDelete}
          className="action-btn hover:text-rose-400 hover:border-rose-500/40"
          title="Remove follow-up"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <style>{`
        .action-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px;
          border-radius: 6px; border: 1px solid hsl(var(--border)); background: hsl(var(--card));
          font-size: 11px; transition: border-color 0.15s, background 0.15s; }
        .action-btn:hover { border-color: hsl(var(--gold) / 0.4); }
      `}</style>
    </motion.div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="truncate">
      <span className="text-[9px] uppercase tracking-wider opacity-60 mr-1">{label}</span>
      <span className="text-foreground/90">{value}</span>
    </div>
  );
}
