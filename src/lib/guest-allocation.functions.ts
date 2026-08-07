/**
 * Guest Allocation Engine — shared server endpoint.
 *
 * Returns the allocation preview for a booking request (room types, rooms,
 * adults, children) WITHOUT persisting anything. Any flow — Booking Engine,
 * OTA import, integration, external validator — can call this to see exactly
 * how HEOS would distribute the party, including per-room extras derived from
 * each room type's configured occupancy.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { previewAllocation } from "@/lib/guest-allocation";

const schema = z.object({
  lines: z
    .array(z.object({ room_type: z.string().min(1), rooms: z.number().int().min(0) }))
    .min(1),
  adults: z.number().int().min(0),
  children: z.number().int().min(0).default(0),
});

export const previewGuestAllocation = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => previewAllocation(data));
