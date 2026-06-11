import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { AdminOnly } from "@/components/admin-only";
import { listRooms, createRoom, updateRoom, deleteRoom, type RoomRow } from "@/lib/rooms-api";
import { Loader2, Plus, Trash2, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/rooms")({
  component: () => <AdminOnly><RoomsPage /></AdminOnly>,
});

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50";

function RoomsPage() {
  const qc = useQueryClient();
  const { data: rooms = [], isLoading } = useQuery({ queryKey: ["rooms"], queryFn: () => listRooms(false) });
  const [editing, setEditing] = useState<RoomRow | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["rooms"] }); };

  const create = useMutation({
    mutationFn: createRoom,
    onSuccess: () => { refresh(); setAdding(false); toast.success("Room added"); },
    onError: (e: any) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: any }) => updateRoom(id, patch),
    onSuccess: () => { refresh(); setEditing(null); toast.success("Updated"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: deleteRoom,
    onSuccess: () => { refresh(); toast.success("Deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const byFloor: Record<number, RoomRow[]> = {};
  for (const r of rooms) (byFloor[r.floor] ||= []).push(r);
  const floors = Object.keys(byFloor).map(Number).sort();

  const occ = rooms.length;
  const oak = rooms.filter(r => r.room_type === "Oak").length;
  const mapple = rooms.filter(r => r.room_type === "Mapple").length;

  return (
    <>
      <Topbar title="Room Master" subtitle="Manage room inventory" />
      <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1200px] space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Total Rooms" value={occ} />
          <Stat label="Oak" value={oak} />
          <Stat label="Mapple" value={mapple} />
        </div>

        <div className="flex justify-end">
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-2 rounded-md gold-gradient px-3 py-2 text-sm font-medium text-charcoal">
            <Plus className="h-4 w-4" /> Add Room
          </button>
        </div>

        {adding && (
          <RoomForm
            onCancel={() => setAdding(false)}
            onSave={(v) => create.mutate(v)}
            pending={create.isPending}
          />
        )}

        {isLoading ? (
          <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
        ) : (
          floors.map((f) => (
            <div key={f} className="luxe-card rounded-xl p-5">
              <h3 className="font-display text-lg mb-3">Floor {f}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {byFloor[f].map((r) => editing?.id === r.id ? (
                  <RoomForm key={r.id} initial={r}
                    onCancel={() => setEditing(null)}
                    onSave={(v) => update.mutate({ id: r.id, patch: v })}
                    onDelete={() => { if (confirm(`Delete room ${r.room_number}?`)) del.mutate(r.id); }}
                    pending={update.isPending}
                  />
                ) : (
                  <div key={r.id}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md border border-border bg-card/60 px-3 py-2",
                      !r.active && "opacity-50",
                    )}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">Room {r.room_number}</div>
                      <div className="text-[10px] text-muted-foreground">{r.room_type}{r.active ? "" : " · Inactive"}</div>
                    </div>
                    <button onClick={() => setEditing(r)} className="p-1.5 text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="luxe-card rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-2xl gold-text-gradient">{value}</div>
    </div>
  );
}

function RoomForm({ initial, onCancel, onSave, onDelete, pending }: {
  initial?: RoomRow;
  onCancel: () => void;
  onSave: (v: { room_number: string; floor: number; room_type: string; active: boolean }) => void;
  onDelete?: () => void;
  pending?: boolean;
}) {
  const [number, setNumber] = useState(initial?.room_number ?? "");
  const [floor, setFloor] = useState(initial?.floor ?? 1);
  const [type, setType] = useState(initial?.room_type ?? "Oak");
  const [active, setActive] = useState(initial?.active ?? true);
  return (
    <div className="luxe-card rounded-xl p-4 space-y-3 col-span-full">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="block"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Number</span>
          <input className={inputCls} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 101" />
        </label>
        <label className="block"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Floor</span>
          <input type="text" inputMode="numeric" pattern="[0-9]*" className={inputCls} value={floor === 0 ? "" : String(floor)}
            onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ""); setFloor(raw === "" ? 0 : Number(raw)); }}
            onBlur={() => { if (!floor) setFloor(1); }} />
        </label>
        <label className="block"><span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Type</span>
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
            <option>Oak</option><option>Mapple</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pt-5">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span className="text-xs">Active</span>
        </label>
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSave({ room_number: number.trim(), floor, room_type: type, active })}
          disabled={!number.trim() || pending}
          className="inline-flex items-center gap-1 rounded-md gold-gradient px-3 py-1.5 text-xs font-medium text-charcoal disabled:opacity-60">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
        </button>
        <button onClick={onCancel} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
        {onDelete && (
          <button onClick={onDelete} className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        )}
      </div>
    </div>
  );
}
