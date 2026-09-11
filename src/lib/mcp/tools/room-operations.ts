import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getRoomTypeAvailability } from "@/lib/room-inventory";
import { listBusyRoomIds } from "@/lib/occupancy-source";
import { listRooms } from "@/lib/rooms-api";
import { guarded, ok, PERM, requirePerm } from "../guard";

export const roomAvailabilityTool = defineTool({
  name: "room_availability",
  title: "Check room availability",
  description: "Return sellable room-type availability using the canonical nightly peak-demand engine.",
  inputSchema: { check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), exclude_booking_id: z.string().uuid().optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async (input, ctx) => {
    const client = await requirePerm(ctx, PERM.rooms);
    const availability = await getRoomTypeAvailability(input, client);
    return ok({ check_in: input.check_in, check_out: input.check_out, ...availability });
  }),
});

export const roomStatusTool = defineTool({
  name: "room_status",
  title: "Get room status",
  description: "Return room master, housekeeping state, and whether each room is occupied or blocked in a date window.",
  inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), room_number: z.string().trim().optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ date, room_number }, ctx) => {
    const client = await requirePerm(ctx, PERM.rooms);
    let rooms = await listRooms(false, client);
    if (room_number) rooms = rooms.filter((r: any) => String(r.room_number) === room_number);
    const end = new Date(date + "T00:00:00"); end.setDate(end.getDate() + 1);
    const busy = await listBusyRoomIds({ check_in: date, check_out: end.toISOString().slice(0, 10) }, client);
    const rows = rooms.map((r: any) => ({ id: r.id, room_number: r.room_number, room_type: r.room_type, active: r.active, housekeeping_status: r.status ?? r.housekeeping_status ?? null, unavailable: busy.has(r.id) }));
    return ok({ date, count: rows.length, rows });
  }),
});