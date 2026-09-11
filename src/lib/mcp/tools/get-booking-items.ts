import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { guarded, ok, PERM, requirePerm } from "../guard";

export default defineTool({
  name: "get_booking_items",
  title: "Get booking rooms",
  description: "Return the independent operational room items and current room assignments for a booking.",
  inputSchema: { booking_id: z.string().uuid() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ booking_id }, ctx) => {
    const client = await requirePerm(ctx, PERM.bookings);
    const [{ data: items, error: itemError }, { data: assignments, error: assignmentError }] = await Promise.all([
      client.from("booking_items" as any).select("id,booking_id,position,room_type,rooms,check_in,check_out,adults,children,rate,nights,item_status,checked_in_at,checked_out_at,assigned_room_id,primary_occupant_name").eq("booking_id", booking_id).order("position"),
      client.from("booking_room_assignments" as any).select("id,item_id,room_id,start_date,end_date,ended_reason,rooms(room_number,room_type)").eq("booking_id", booking_id).order("start_date"),
    ]);
    if (itemError) throw itemError;
    if (assignmentError) throw assignmentError;
    return ok({ booking_id, item_count: items?.length ?? 0, items: items ?? [], occupancy_segments: assignments ?? [] });
  }),
});