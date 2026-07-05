/**
 * Housekeeping — Today's Tasks.
 *
 * The one and only surface for the `housekeeping` role. FO Staff / admin
 * also reach it (from House View, or via the sidebar entry) but do not land
 * here after login. Design refs: §5.1, §5.2, §5.3.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ChevronRight, Brush, Sparkles, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getBusinessDate } from "@/lib/night-audit-api";
import { listRooms } from "@/lib/rooms-api";
import { listInventoryItems } from "@/lib/inventory-items-api";
import { listLinenTypes } from "@/lib/linen-master-api";
import { listHkIssueTypes } from "@/lib/hk-issue-types-api";
import { listTasksForDate, startTask, completeTask, skipTask, type HkTaskRow, type HkSkipReason } from "@/lib/hk-tasks";
import { useHkWorkingAs } from "@/hooks/use-hk-working-as";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import { NumField } from "@/components/num-field";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/housekeeping")({
  component: HousekeepingPage,
});

function HousekeepingPage() {
  const qc = useQueryClient();
  const { data: businessDate } = useQuery({
    queryKey: ["business-date"],
    queryFn: getBusinessDate,
    staleTime: 30_000,
  });

  const { data: tasks = [], isLoading: tLoading } = useQuery({
    queryKey: ["hk-tasks", businessDate],
    queryFn: () => listTasksForDate(businessDate as string),
    enabled: !!businessDate,
    refetchInterval: 15_000,
  });
  const { data: rooms = [] } = useQuery({
    queryKey: ["rooms", "active"],
    queryFn: () => listRooms(true),
    staleTime: 60_000,
  });

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const openTask = tasks.find((t) => t.id === openTaskId) ?? null;

  const { selected: workingAs, candidates: waCandidates, setSelectedId } = useHkWorkingAs();
  const me = useCurrentStaff();

  const roomById = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of rooms as any[]) m.set(r.id, r);
    return m;
  }, [rooms]);

  const open = tasks.filter((t) => t.state === "open" || t.state === "in_progress");
  const done = tasks.filter((t) => t.state === "done" || t.state === "skipped");
  const checkouts = open.filter((t) => t.type === "checkout_clean");
  const services = open.filter((t) => t.type === "continue_service");
  const total = tasks.filter((t) => t.state !== "skipped" || t.skipped_reason !== "superseded_by_checkout").length;

  const startMut = useMutation({
    mutationFn: (id: string) => {
      if (!workingAs) throw new Error("Choose 'Working As' first");
      return startTask(id, { id: workingAs.id, name: workingAs.name });
    },
    onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ["hk-tasks"] }); setOpenTaskId(id); },
    onError: (e: any) => toast.error(e.message),
  });

  const skipMut = useMutation({
    mutationFn: async (input: { task: HkTaskRow; reason: HkSkipReason }) => {
      if (!me.id) throw new Error("Not signed in");
      const actor = { id: me.id, name: me.name || me.firstName || "user" };
      await skipTask(input.task.id, input.reason, actor);
      if (input.reason === "not_required" || input.reason === "dnd") {
        // Record an exception row so tomorrow's generator honours it.
        await supabase.from("housekeeping_room_exceptions" as any).upsert({
          room_id: input.task.room_id,
          business_date: input.task.business_date,
          reason: input.reason === "dnd" ? "do_not_disturb" : "service_not_required",
          set_by_user_id: actor.id,
          set_by_name: actor.name,
        } as any, { onConflict: "room_id,business_date" } as any);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hk-tasks"] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
      toast.success("Task skipped");
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (openTask) {
    return (
      <TaskScreen
        task={openTask}
        room={roomById.get(openTask.room_id)}
        onClose={() => setOpenTaskId(null)}
        workingAs={workingAs}
        candidates={waCandidates}
        onSelectPerformer={setSelectedId}
        me={{ id: me.id ?? "", name: me.name || me.firstName || "user" }}
      />
    );
  }


  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 bg-background/85 backdrop-blur border-b border-border">
        <div className="px-4 py-3 md:py-4 max-w-2xl mx-auto">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Today</div>
              <div className="font-display text-lg md:text-xl leading-tight">
                {businessDate ? formatFriendlyDate(businessDate) : "—"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Progress</div>
              <div className="text-sm">
                <span className="text-gold font-semibold">{done.length}</span>
                {" / "}
                <span>{total || open.length + done.length}</span> Completed
              </div>
            </div>
          </div>
          <WorkingAsBar
            candidates={waCandidates}
            selectedId={workingAs?.id ?? null}
            onSelect={setSelectedId}
          />

        </div>
      </div>

      <div className="px-4 py-6 max-w-2xl mx-auto space-y-6">
        {tLoading && (
          <div className="p-16 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        )}
        {!tLoading && open.length === 0 && (
          <div className="p-16 text-center text-muted-foreground text-sm">All caught up.</div>
        )}

        <Section title="Checkout Rooms" count={checkouts.length} icon={<Brush className="h-4 w-4" />}>
          {checkouts.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              room={roomById.get(t.room_id)}
              actionLabel={t.state === "in_progress" ? "Continue" : "Start Cleaning"}
              onAction={() => t.state === "in_progress" ? setOpenTaskId(t.id) : startMut.mutate(t.id)}
              busy={startMut.isPending}
            />
          ))}
          {checkouts.length === 0 && <EmptyMini>No checkout rooms right now.</EmptyMini>}
        </Section>

        <Section title="Service Rooms" count={services.length} icon={<Sparkles className="h-4 w-4" />}>
          {services.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              room={roomById.get(t.room_id)}
              actionLabel={t.state === "in_progress" ? "Continue" : "Start Service"}
              onAction={() => t.state === "in_progress" ? setOpenTaskId(t.id) : startMut.mutate(t.id)}
              busy={startMut.isPending}
              onSkip={(reason) => skipMut.mutate({ task: t, reason })}
            />
          ))}
          {services.length === 0 && <EmptyMini>No service rooms in the queue.</EmptyMini>}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, count, icon, children }: { title: string; count: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}<span>{title}</span><span className="text-gold">· {count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function EmptyMini({ children }: { children: React.ReactNode }) {
  return <div className="luxe-card rounded-lg p-4 text-xs text-muted-foreground">{children}</div>;
}

function TaskCard({ task, room, actionLabel, onAction, busy, onSkip }: {
  task: HkTaskRow;
  room: any;
  actionLabel: string;
  onAction: () => void;
  busy?: boolean;
  onSkip?: (reason: HkSkipReason) => void;
}) {
  return (
    <div className="luxe-card rounded-lg overflow-hidden">
      <button
        onClick={onAction}
        disabled={busy}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-muted/20 transition disabled:opacity-60"
      >
        <div>
          <div className="text-sm font-medium">
            {room?.room_number ?? "?"} · {room?.room_type ?? ""}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {task.state === "in_progress"
              ? `In progress · ${task.performed_by_name ?? ""}`
              : (task.type === "checkout_clean" ? "Ready for cleaning" : "Needs service")}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gold">{actionLabel}</span>
          <ChevronRight className="h-4 w-4 text-gold" />
        </div>
      </button>
      {onSkip && task.state !== "in_progress" && (
        <div className="border-t border-border/60 flex text-[11px]">
          <button
            onClick={(e) => { e.stopPropagation(); onSkip("not_required"); }}
            className="flex-1 py-2 text-muted-foreground hover:text-foreground border-r border-border/60"
          >
            Service Not Required
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onSkip("dnd"); }}
            className="flex-1 py-2 text-muted-foreground hover:text-foreground"
          >
            Do Not Disturb
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────  Task Screen  ───────────────────────────── */

function TaskScreen({ task, room, onClose, workingAs, candidates, onSelectPerformer, me }: {
  task: HkTaskRow;
  room: any;
  onClose: () => void;
  workingAs: { id: string; name: string } | null;
  candidates: { id: string; name: string }[];
  onSelectPerformer: (id: string) => void;
  me: { id: string; name: string };
}) {
  const qc = useQueryClient();
  const { data: consumables = [] } = useQuery({
    queryKey: ["hk-consumables"],
    queryFn: async () => {
      const items = await listInventoryItems();
      return items.filter((i: any) => i.show_in_housekeeping && i.active !== false);
    },
    staleTime: 60_000,
  });
  const { data: linenTypes = [] } = useQuery({
    queryKey: ["hk-linen-types"],
    queryFn: () => listLinenTypes(true),
    staleTime: 60_000,
  });
  const { data: issueTypes = [] } = useQuery({
    queryKey: ["hk-issue-types"],
    queryFn: () => listHkIssueTypes(true),
    staleTime: 60_000,
  });

  const [consumSel, setConsumSel] = useState<Record<string, { on: boolean; qty: number }>>({});
  const [linenSel, setLinenSel]   = useState<Record<string, boolean>>({});
  const [issueSel, setIssueSel]   = useState<Record<string, { on: boolean; note: string }>>({});
  const [remarks, setRemarks]     = useState<string>("");
  const [saving, setSaving]       = useState(false);
  const [noIssue, setNoIssue]     = useState(true);

  const isCheckout = task.type === "checkout_clean";

  async function onSubmit() {
    if (!workingAs) { toast.error("Choose 'Working As' first"); return; }
    setSaving(true);
    try {
      const consLines = Object.entries(consumSel)
        .filter(([, v]) => v.on && v.qty > 0)
        .map(([id, v]) => {
          const item = (consumables as any[]).find((c) => c.id === id);
          return { inventory_item_id: id, name_at_time: item?.name ?? "", qty: v.qty };
        }).filter((r) => r.inventory_item_id);
      const linenLines = Object.entries(linenSel)
        .filter(([, on]) => on)
        .map(([id]) => {
          const l = (linenTypes as any[]).find((x) => x.id === id);
          return { linen_type_id: id, name_at_time: l?.name ?? "", qty: l?.default_qty ?? 1 };
        });
      const issueLines = noIssue
        ? []
        : Object.entries(issueSel)
            .filter(([, v]) => v.on)
            .map(([id, v]) => {
              const it = (issueTypes as any[]).find((x) => x.id === id);
              return {
                issue_type_id: id,
                label_at_time: it?.label ?? "",
                note: v.note,
                default_complaint_category_id: it?.default_complaint_category_id ?? null,
              };
            });
      await completeTask(task.id, {
        consumables: consLines,
        linen: linenLines,
        issues: issueLines,
        remarks,
        performer: workingAs,
        recorder:  me,
      });
      toast.success(isCheckout ? "Cleaning complete" : "Service complete");
      qc.invalidateQueries({ queryKey: ["hk-tasks"] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 bg-background/85 backdrop-blur border-b border-border">
        <div className="px-4 py-3 max-w-2xl mx-auto space-y-2">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted"><ArrowLeft className="h-4 w-4" /></button>
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {isCheckout ? "Checkout Cleaning" : "Room Service"}
              </div>
              <div className="font-display text-base leading-tight">
                {room?.room_number ?? "?"} · {room?.room_type ?? ""}
              </div>
            </div>
            <div className="text-right leading-tight">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Performing</div>
              <div className="text-xs text-gold font-medium max-w-[140px] truncate">{workingAs?.name ?? "—"}</div>
            </div>
          </div>
          <WorkingAsBar
            candidates={candidates}
            selectedId={workingAs?.id ?? null}
            onSelect={onSelectPerformer}
            compact
          />
        </div>
      </div>



      <div className="px-4 py-6 max-w-2xl mx-auto space-y-5">
        <BlockTitle n={1}>Consumables Refilled</BlockTitle>
        <div className="luxe-card rounded-lg p-3 space-y-2">
          {(consumables as any[]).length === 0 && (
            <div className="text-xs text-muted-foreground">No housekeeping consumables configured. Ask admin to enable items under Inventory.</div>
          )}
          {(consumables as any[]).map((it) => {
            const defaultQty = Number(it.hk_default_qty ?? 1) || 1;
            const sel = consumSel[it.id] ?? { on: false, qty: defaultQty };
            const isEditing = consumEdit[it.id] === true;
            return (
              <div key={it.id} className="space-y-1">
                <label className="flex items-center gap-3 text-sm py-1">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={sel.on}
                    onChange={(e) => setConsumSel((s) => ({ ...s, [it.id]: { on: e.target.checked, qty: sel.qty } }))}
                  />
                  <span className="flex-1">{it.name}</span>
                  <span className="text-[11px] text-muted-foreground">× {sel.qty}</span>
                  {sel.on && (
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setConsumEdit((s) => ({ ...s, [it.id]: !isEditing })); }}
                      className="text-[10px] uppercase tracking-wider text-gold px-2 py-0.5 rounded border border-border"
                    >
                      {isEditing ? "Done" : "Edit"}
                    </button>
                  )}
                </label>
                {sel.on && isEditing && (
                  <div className="ml-8 w-28">
                    <NumField
                      value={sel.qty}
                      min={0}
                      onChange={(v) => setConsumSel((s) => ({ ...s, [it.id]: { on: sel.on, qty: v } }))}
                      decimal
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <BlockTitle n={2}>Linen Changed</BlockTitle>
        <div className="luxe-card rounded-lg p-3 space-y-2">
          {(linenTypes as any[]).length === 0 && (
            <div className="text-xs text-muted-foreground">No linen types configured. Admin can add them under Masters.</div>
          )}
          {(linenTypes as any[]).map((l) => (
            <label key={l.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!linenSel[l.id]}
                onChange={(e) => setLinenSel((s) => ({ ...s, [l.id]: e.target.checked }))} />
              <span className="flex-1">{l.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">auto qty {l.default_qty}</span>
            </label>
          ))}
        </div>

        <BlockTitle n={3}>Issues</BlockTitle>
        <div className="luxe-card rounded-lg p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="hk-noissue" checked={noIssue} onChange={() => setNoIssue(true)} />
            <span>No Issue</span>
          </label>
          {(issueTypes as any[]).map((it) => {
            const sel = issueSel[it.id] ?? { on: false, note: "" };
            return (
              <div key={it.id} className="space-y-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={sel.on}
                    onChange={(e) => {
                      setNoIssue(false);
                      setIssueSel((s) => ({ ...s, [it.id]: { on: e.target.checked, note: sel.note } }));
                    }}
                  />
                  <span>{it.label}</span>
                </label>
                {sel.on && (
                  <input
                    type="text"
                    value={sel.note}
                    onChange={(e) => setIssueSel((s) => ({ ...s, [it.id]: { on: sel.on, note: e.target.value } }))}
                    placeholder="Short note (optional)"
                    className="w-full ml-6 bg-input/60 border border-border rounded-md px-2 py-1 text-xs"
                  />
                )}
              </div>
            );
          })}
        </div>

        <BlockTitle n={4}>Remarks (optional)</BlockTitle>
        <textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={2}
          className="w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm"
          placeholder="Anything else"
        />

        <div className="text-[11px] text-muted-foreground pt-2 flex justify-between">
          <span>Performed by: <span className="text-foreground">{workingAs?.name ?? "—"}</span></span>
          <span>Recorded by: <span className="text-foreground">{me.name}</span></span>
        </div>

        <button
          disabled={saving}
          onClick={onSubmit}
          className={cn(
            "w-full rounded-md gold-gradient py-3 text-sm font-medium text-charcoal",
            "hover:shadow-[0_0_18px_oklch(0.82_0.13_82/0.35)] disabled:opacity-50",
          )}
        >
          {saving ? "Saving…" : isCheckout ? "Finish Cleaning" : "Finish Service"}
        </button>
      </div>
    </div>
  );
}

function BlockTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
      {n}. {children}
    </div>
  );
}

function formatFriendlyDate(d: string): string {
  try {
    const dt = new Date(`${d}T00:00:00`);
    return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  } catch { return d; }
}
