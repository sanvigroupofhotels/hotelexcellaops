import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getBusinessDate } from "@/lib/night-audit-api";
import { listInHouseItems } from "@/lib/in-house";
import { capLimit, guarded, ok, PERM, requirePerm } from "../guard";

const dateInput = { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), limit: z.number().int().min(1).max(200).optional() };

function safeItemRow(item: any, booking: any, rooms: Map<string, any>) {
  const room = item.assigned_room_id ? rooms.get(item.assigned_room_id) : null;
  return { booking_id: booking.id, booking_reference: booking.booking_reference, booker_name: booking.guest_name, booking_status: booking.status, item_id: item.id, item_status: item.item_status, occupant_name: item.primary_occupant_name ?? null, room_type: item.room_type, room_id: item.assigned_room_id ?? null, room_number: room?.room_number ?? null, check_in: item.check_in, check_out: item.check_out };
}

function operationalList(kind: "arrivals" | "departures") {
  return defineTool({
    name: kind,
    title: kind === "arrivals" ? "List arrivals" : "List departures",
    description: `List item-aware ${kind} for a date, defaulting to the HEOS business date.`,
    inputSchema: dateInput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: guarded(async ({ date, limit }, ctx) => {
      const client = await requirePerm(ctx, PERM.bookings);
      const target = date ?? await getBusinessDate(client);
      const column = kind === "arrivals" ? "check_in" : "check_out";
      const { data: items, error } = await client.from("booking_items" as any).select("id,booking_id,item_status,primary_occupant_name,room_type,assigned_room_id,check_in,check_out,bookings!inner(id,booking_reference,guest_name,status)").eq(column, target).not("bookings.status", "in", "(Cancelled,No-Show,Draft)").order("position").limit(capLimit(limit));
      if (error) throw error;
      const roomIds = [...new Set((items ?? []).map((x: any) => x.assigned_room_id).filter(Boolean))];
      const roomMap = new Map<string, any>();
      if (roomIds.length) {
        const { data: rooms, error: roomError } = await client.from("rooms").select("id,room_number").in("id", roomIds);
        if (roomError) throw roomError;
        for (const room of rooms ?? []) roomMap.set(room.id, room);
      }
      const rows = (items ?? []).map((x: any) => safeItemRow(x, x.bookings, roomMap));
      return ok({ date: target, count: rows.length, rows });
    }),
  });
}

export const arrivalsTool = operationalList("arrivals");
export const departuresTool = operationalList("departures");

export const inHouseGuestsTool = defineTool({
  name: "in_house_guests",
  title: "List in-house guests",
  description: "List the canonical item-aware set of guests physically in house.",
  inputSchema: { limit: z.number().int().min(1).max(200).optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ limit }, ctx) => {
    const client = await requirePerm(ctx, PERM.bookings);
    const rows = (await listInHouseItems(client)).slice(0, capLimit(limit)).map((x) => ({ booking_id: x.bookingId, item_id: x.itemId, booker_name: x.booking.guest_name, occupant_name: x.primaryOccupant, room_id: x.roomId, room_number: x.roomNumber, room_type: x.roomType, check_in: x.item.check_in, check_out: x.item.check_out }));
    return ok({ count: rows.length, rows });
  }),
});