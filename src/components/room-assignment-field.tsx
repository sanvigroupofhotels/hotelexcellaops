import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listRooms, findRoomConflicts, type RoomConflict } from "@/lib/rooms-api";
import { AlertTriangle, BedDouble } from "lucide-react";

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

interface Props {
  value: string | null;
  onChange: (room_id: string | null) => void;
  check_in: string;
  check_out: string;
  excludeBookingId?: string;
}

/**
 * Room picker with overlap warning.
 * Dropdown shows ALL active rooms (with a non-conflicting subset marked); we warn on conflict
 * but don't hard-block, per spec.
 */
export function RoomAssignmentField({ value, onChange, check_in, check_out, excludeBookingId }: Props) {
  const { data: rooms = [] } = useQuery({ queryKey: ["rooms", "active"], queryFn: () => listRooms(true) });
  const [conflicts, setConflicts] = useState<RoomConflict[]>([]);

  useEffect(() => {
    let alive = true;
    if (!value || !check_in || !check_out) { setConflicts([]); return; }
    findRoomConflicts(value, check_in, check_out, excludeBookingId)
      .then((c) => { if (alive) setConflicts(c); })
      .catch(() => { if (alive) setConflicts([]); });
    return () => { alive = false; };
  }, [value, check_in, check_out, excludeBookingId]);

  // Optionally compute conflicting room set across all rooms for ordering — for now we just show all
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
          <BedDouble className="h-3 w-3" /> Room Assignment <span className="text-muted-foreground/60 normal-case tracking-normal">(optional)</span>
        </span>
        <select className={inputCls} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">— Not assigned —</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>Room {r.room_number} · {r.room_type} · Floor {r.floor}</option>
          ))}
        </select>
      </label>

      {conflicts.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs space-y-1.5">
          <div className="flex items-center gap-1.5 font-medium text-warning">
            <AlertTriangle className="h-3.5 w-3.5" /> Room Conflict Detected
          </div>
          {conflicts.map((c) => (
            <div key={c.booking_id} className="text-foreground/80">
              {c.guest_name} · {new Date(c.check_in).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} → {new Date(c.check_out).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} <span className="text-muted-foreground">({c.status})</span>
            </div>
          ))}
          <div className="text-muted-foreground pt-1">Choose another room or save to continue anyway.</div>
        </div>
      )}
    </div>
  );
}
