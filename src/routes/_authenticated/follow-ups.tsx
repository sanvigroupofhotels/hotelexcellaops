import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Topbar } from "@/components/topbar";
import { listFollowups, completeFollowup, deleteFollowup, buildWhatsAppLink, logWhatsApp } from "@/lib/quotes-api";
import { Bell, MessageCircle, Check, Trash2, Loader2, Clock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/follow-ups")({
  component: FollowUps,
});

function FollowUps() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ["followups"], queryFn: listFollowups });

  const complete = useMutation({
    mutationFn: ({ id, quote_id }: any) => completeFollowup(id, quote_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["followups"] });
      toast.success("Follow-up completed");
    },
  });
  const del = useMutation({
    mutationFn: deleteFollowup,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["followups"] });
      toast.success("Follow-up removed");
    },
  });

  const now = Date.now();

  return (
    <>
      <Topbar title="Follow-ups" subtitle="Thoughtful, timely touches that convert" />
      <div className="px-4 md:px-8 py-6 md:py-8 space-y-3 max-w-[1100px]">
        {isLoading && (
          <div className="p-12 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-gold" />
          </div>
        )}
        {!isLoading && data.length === 0 && (
          <div className="luxe-card rounded-xl p-12 text-center text-sm text-muted-foreground">
            No follow-ups scheduled. Add one from a quote's detail page.
          </div>
        )}
        {data.map((f: any, i: number) => {
          const overdue = !f.completed && new Date(f.due_at).getTime() < now;
          const q = f.quotes;
          return (
            <motion.div
              key={f.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className={cn(
                "luxe-card rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-3",
                f.completed && "opacity-60",
                overdue && "border-destructive/40",
              )}
            >
              <div className="h-10 w-10 rounded-md bg-gold-soft border border-gold/30 flex items-center justify-center">
                {overdue ? <Clock className="h-4 w-4 text-destructive" /> : <Bell className="h-4 w-4 text-gold" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to="/quote/$id" params={{ id: f.quote_id }} className="text-sm hover:text-gold">
                    {q?.guest_name ?? "Unknown guest"}
                  </Link>
                  <span className="text-[11px] text-muted-foreground font-mono">{q?.reference_code}</span>
                  {overdue && (
                    <span className="text-[10px] uppercase tracking-wider text-destructive">Overdue</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Due: {new Date(f.due_at).toLocaleString("en-IN")}
                  {f.note && ` · ${f.note}`}
                </div>
              </div>
              <div className="flex gap-2">
                {q && (
                  <a
                    href={buildWhatsAppLink(q)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => logWhatsApp(q.id)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-success/15 border border-success/40 text-success px-3 py-2 text-xs hover:bg-success/20"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                  </a>
                )}
                {!f.completed && (
                  <button
                    onClick={() => complete.mutate({ id: f.id, quote_id: f.quote_id })}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs hover:border-gold/40"
                  >
                    <Check className="h-3.5 w-3.5 text-gold" /> Done
                  </button>
                )}
                <button
                  onClick={() => del.mutate(f.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs hover:text-destructive hover:border-destructive/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </>
  );
}
