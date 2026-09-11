import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { placeHouseViewChips } from "@/lib/house-view-placement";
import { groupStayAssignments, groupStayItems } from "@/lib/stay-segments";
import { addDaysYmd, guarded, McpToolError, ok, PERM, requirePerm } from "../guard";

export default defineTool({
  name: "house_view",
  title: "Get House View",
  description: "Return the shared HEOS House View placement for a capped date window, including turnover and pending arrivals.",
  inputSchema: { start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), days: z.number().int().min(1).max(14).optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ start_date, days }, ctx) => {
    const client = await requirePerm(ctx, PERM.bookings);
    const end = addDaysYmd(start_date, days ?? 7);
    const [bookingRes, itemRes, assignmentRes, roomRes, blockRes] = await Promise.all([
      client.from("bookings").select("id,booking_reference,guest_name,status,check_in,check_out").not("status", "in", "(Cancelled,No-Show,Draft)").lt("check_in", end).gte("check_out", start_date),
      client.from("booking_items" as any).select("id,booking_id,position,assigned_room_id,room_type,rooms,check_in,check_out,item_status,checked_out_at,primary_occupant_name,late_check_out,late_check_out_slot").lt("check_in", end).gte("check_out", start_date),
      client.from("booking_room_assignments" as any).select("id,booking_id,item_id,room_id,created_at,start_date,end_date,ended_reason").lt("start_date", end).gte("end_date", start_date),
      client.from("rooms").select("id,room_number,room_type,active").eq("active", true),
      client.from("room_maintenance" as any).select("room_id,start_date,end_date,active").eq("active", true).lt("start_date", end).gt("end_date", start_date),
    ]);
    const error = bookingRes.error ?? itemRes.error ?? assignmentRes.error ?? roomRes.error ?? blockRes.error;
    if (error) throw error;
    const bookings = (bookingRes.data ?? []) as any[], items = (itemRes.data ?? []) as any[], assignments = (assignmentRes.data ?? []) as any[], rooms = (roomRes.data ?? []) as any[];
    const late = new Map<string, number>(), rank: Record<string, number> = { "upto-2pm": .25, "2-4pm": .5, "after-4pm": .75 };
    for (const item of items) if (item.late_check_out) late.set(item.booking_id, Math.max(late.get(item.booking_id) ?? 0, rank[item.late_check_out_slot] ?? 0));
    const placed = placeHouseViewChips({ bookings, itemsByBooking: groupStayItems(items), assignmentsByBooking: groupStayAssignments(assignments), rooms, blocks: (blockRes.data ?? []) as any[], rangeStart: start_date, rangeEndExclusive: end, lateFractionByBooking: late, outgoingLateSeed: new Map(), businessDate: start_date });
    const rows: any[] = [];
    for (const room of rooms) for (const chip of placed.byRoom.get(room.id) ?? []) rows.push({ room_number: room.room_number, room_type: room.room_type, booking_id: chip.id, booking_reference: chip.booking_reference, booker_name: chip.guest_name, occupant_name: chip._occupantName ?? null, item_id: chip._itemId ?? null, item_status: chip._itemStatus ?? chip.status, check_in: chip.check_in, check_out: chip.check_out, virtual: !!chip._virtual, turnover_arrival: !!chip._turnoverArrival, turnover_departure: !!chip._turnoverDeparture });
    if (rows.length > 500) throw new McpToolError("House View result is too large; request a shorter window.");
    return ok({ start_date, end_date_exclusive: end, rows, pending_arrivals: placed.pendingArrivals.map((p) => ({ booking_id: p.booking.id, booking_reference: p.booking.booking_reference, room_type: p.room_type, check_in: p.check_in, check_out: p.check_out, turnover_rooms: p.turnoverRooms })) });
  }),
});