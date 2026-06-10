import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listRooms, findRoomConflicts, type RoomConflict } from "@/lib/rooms-api";
import { listActiveBlocks, isRoomBlockedInRange } from "@/lib/blocks-api";
import { AlertTriangle, BedDouble } from "lucide-react";

const inputCls =
  "w-full bg-input/60 border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition";

interface Props {
  value: string | null;
  onChange: (room_id: string | null) => void;
  check_in: string;
  check_out: string;
  excludeBookingId?: string;
  /** Optional room-type filter (e.g. "Oak Room" → only Oak rooms shown). */
  roomType?: string;
}

/**
 * Room picker with overlap warning.
 * Rooms with an active block covering the stay dates are hidden.
 */
export function RoomAssignmentField({ value, onChange, check_in, check_out, excludeBookingId, roomType }: Props) {
  const { data: allRooms = [] } = useQuery({ queryKey: ["rooms", "active"], queryFn: () => listRooms(true) });
  const { data: blocks = [] } = useQuery({ queryKey: ["blocks", "active"], queryFn: listActiveBlocks });
  const [conflicts, setConflicts] = useState<RoomConflict[]>([]);

  // Filter by room type, then drop any room blocked for the stay dates.
  const filteredByType = roomType
    ? allRooms.filter((r) => r.room_type.toLowerCase().includes(roomType.split(" ")[0].toLowerCase()))
    : allRooms;
  const rooms = check_in && check_out
    ? filteredByType.filter((r) => !isRoomBlockedInRange(blocks, r.id, check_in, check_out))
    : filteredByType;

  useEffect(() => {
    let alive = true;
    if (!value || !check_in || !check_out) { setConflicts([]); return; }
    findRoomConflicts(value, check_in, check_out, excludeBookingId)
      .then((c) => { if (alive) setConflicts(c); })
      .catch(() => { if (alive) setConflicts([]); });
    return () => { alive = false; };
  }, [value, check_in, check_out, excludeBookingId]);

  const blockedHit = value ? isRoomBlockedInRange(blocks, value, check_in, check_out) : null;

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
          <BedDouble className="h-3 w-3" /> Room Assignment
          {roomType && <span className="text-muted-foreground/60 normal-case tracking-normal">· {roomType} only</span>}
        </span>
        <select className={inputCls} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">— Not assigned —</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>{r.room_number}</option>
          ))}
        </select>
      </label>

      {blockedHit && (
        <div className="rounded-md border border-amber-600/50 bg-amber-600/10 p-3 text-xs text-amber-800 dark:text-amber-300">
          <div className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-3.5 w-3.5" /> Room is blocked</div>
          <div className="opacity-80 mt-1">{blockedHit.reason || "Maintenance"} · {blockedHit.start_date} → {blockedHit.end_date}</div>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs space-y-1.5">
          <div className="flex items-center gap-1.5 font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> Room Conflict Detected
          </div>
          {conflicts.map((c) => (
            <div key={c.booking_id} className="text-foreground/80">
              {c.guest_name} · {new Date(c.check_in).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} → {new Date(c.check_out).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} <span className="text-muted-foreground">({c.status})</span>
            </div>
          ))}
          <div className="text-muted-foreground pt-1">Staff cannot save overlapping bookings. Choose a different room or ask an admin to override.</div>
        </div>
      )}
    </div>
  );
}

