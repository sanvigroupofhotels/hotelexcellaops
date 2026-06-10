import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { blockRoom, updateBlock, unblockRoom, type BlockRow } from "@/lib/blocks-api";

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50";

const REASONS = ["Maintenance", "AC Repair", "Plumbing", "Deep Cleaning", "Owner Use", "Other"];

export function BlockRoomDialog({
  roomId, roomNumber, defaultStart, defaultEnd, existing, onClose,
}: {
  roomId: string;
  roomNumber: string;
  defaultStart?: string;
  defaultEnd?: string;
  existing?: BlockRow | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const tom = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [start, setStart] = useState(existing?.start_date ?? defaultStart ?? today);
  const [end, setEnd] = useState(existing?.end_date ?? defaultEnd ?? tom);
  const [reason, setReason] = useState(existing?.reason ?? REASONS[0]);
  const [customReason, setCustomReason] = useState(existing && !REASONS.includes(existing.reason ?? "") ? existing.reason ?? "" : "");

  const save = useMutation({
    mutationFn: async () => {
      const finalReason = reason === "Other" ? customReason.trim() || "Other" : reason;
      if (existing?.id) {
        await updateBlock(existing.id, { start_date: start, end_date: end, reason: finalReason });
      } else {
        await blockRoom({ room_id: roomId, start_date: start, end_date: end, reason: finalReason });
      }
    },
    onSuccess: () => {
      toast.success(existing ? "Block updated" : "Room blocked");
      qc.invalidateQueries({ queryKey: ["room_maintenance"] });
      qc.invalidateQueries({ queryKey: ["blocks"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message || "Failed"),
  });

  const unblock = useMutation({
    mutationFn: async () => { if (existing?.id) await unblockRoom(existing.id); },
    onSuccess: () => {
      toast.success("Room unblocked");
      qc.invalidateQueries({ queryKey: ["room_maintenance"] });
      qc.invalidateQueries({ queryKey: ["blocks"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message || "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="luxe-card rounded-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h3 className="font-display text-xl flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            {existing ? "Edit Block" : "Block Room"} {roomNumber}
          </h3>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">From</span>
            <input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">To</span>
            <input type="date" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Reason</span>
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>

        {reason === "Other" && (
          <input className={inputCls} placeholder="Custom reason" value={customReason} onChange={(e) => setCustomReason(e.target.value)} />
        )}

        {existing && (
          <div className="rounded-md border border-border bg-secondary/30 p-3 text-[11px] text-muted-foreground space-y-1">
            <div>Blocked: {new Date(existing.blocked_at).toLocaleString("en-IN")}</div>
            {existing.unblocked_at && <div>Unblocked: {new Date(existing.unblocked_at).toLocaleString("en-IN")}</div>}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {existing && (
            <button onClick={() => unblock.mutate()} disabled={unblock.isPending}
              className="flex-1 rounded-md border border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-400 px-3 py-2 text-xs font-medium hover:bg-green-600/20 disabled:opacity-60">
              {unblock.isPending ? <Loader2 className="h-3 w-3 animate-spin mx-auto" /> : "Unblock Room"}
            </button>
          )}
          <button onClick={() => save.mutate()} disabled={save.isPending || end <= start}
            className="flex-1 gold-gradient text-charcoal rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60">
            {save.isPending ? "Saving…" : existing ? "Save Changes" : "Block Room"}
          </button>
        </div>
      </div>
    </div>
  );
}
