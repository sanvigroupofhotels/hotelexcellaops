/**
 * Booking Item lifecycle timeline — HEOS Phase 2 Milestone 1.
 *
 * Renders `booking_item_activities` for a booking, grouped by operational
 * room (Booking Item) and ordered chronologically. Surfaces every event
 * relevant to reception review: room assignment, moves, occupant updates,
 * operational notes, per-item check-in / check-out, and room removals.
 *
 * Reads from `listBookingItemActivities`; the same rows drive the per-item
 * "Room Operations Audit" strip in RoomManagementGrid — this component is the
 * full, expandable view.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { listBookingItemActivities, type BookingItemActivityRow } from "@/lib/booking-item-operations-api";

const ACTION_LABEL: Record<string, string> = {
  item_room_assigned: "Room assigned",
  item_room_move: "Room moved",
  item_room_removed: "Room removed",
  item_check_in: "Item checked in",
  item_check_out: "Item checked out",
  item_occupant_updated: "Occupant updated",
  item_notes_updated: "Operational notes updated",
};

function actionLabel(a: BookingItemActivityRow): string {
  return ACTION_LABEL[a.action] ?? a.action;
}

const fmt = (s: string) =>
  new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function BookingItemTimeline({
  bookingId,
  items,
  rooms,
}: {
  bookingId: string;
  items: any[];
  rooms: any[];
}) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["booking-item-activities", bookingId],
    queryFn: () => listBookingItemActivities(bookingId),
    enabled: !!bookingId,
  });

  const grouped = useMemo(() => {
    const map = new Map<string, BookingItemActivityRow[]>();
    for (const r of rows) {
      const list = map.get(r.item_id) ?? [];
      list.push(r);
      map.set(r.item_id, list);
    }
    // Preserve booking-item order (by position) so the timeline reads top-down.
    return items
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((it) => ({
        item: it,
        events: (map.get(it.id) ?? []).slice().reverse(), // oldest → newest inside each item
      }));
  }, [rows, items]);

  const roomLabel = (id: string | null | undefined) => {
    if (!id) return null;
    const r = rooms.find((x) => x.id === id);
    return r ? `Room ${r.room_number}` : null;
  };

  return (
    <div className="luxe-card rounded-xl p-5">
      <h4 className="font-display text-lg mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-gold" /> Room Lifecycle Timeline
      </h4>
      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : grouped.every((g) => g.events.length === 0) ? (
        <div className="text-xs text-muted-foreground italic">
          No room lifecycle events yet.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ item, events }, idx) => {
            if (events.length === 0) return null;
            const currentRoom = roomLabel(item.assigned_room_id);
            return (
              <div key={item.id} className="rounded-md border border-border/60 bg-muted/10">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
                  <div className="text-sm font-medium">
                    Room Item {idx + 1}
                    <span className="ml-2 text-[11px] text-muted-foreground">{item.room_type}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {currentRoom ?? "Unassigned"} · {item.item_status ?? "Confirmed"}
                  </div>
                </div>
                <ol className="relative ml-4 my-2 border-l border-border/60">
                  {events.map((e) => (
                    <li key={e.id} className="pl-3 pr-3 py-1.5 relative">
                      <span className="absolute -left-[5px] top-2 h-2 w-2 rounded-full bg-gold" />
                      <div className="text-[12px]">
                        <span className="font-medium">{actionLabel(e)}</span>
                        {e.summary ? <span className="text-muted-foreground"> — {e.summary}</span> : null}
                      </div>
                      <div className="text-[10.5px] text-muted-foreground tabular-nums">
                        {fmt(e.created_at)}
                        {e.actor_name ? ` · ${e.actor_name}` : ""}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
