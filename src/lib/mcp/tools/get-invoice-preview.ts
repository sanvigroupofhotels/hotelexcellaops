import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { buildInvoiceDocument } from "@/lib/invoice-document";
import { listBookingCharges } from "@/lib/booking-charges-api";
import { listBookingPayments } from "@/lib/booking-payments-api";
import { guarded, McpToolError, ok, PERM, requirePerm } from "../guard";

export default defineTool({
  name: "get_invoice_preview",
  title: "Get invoice preview",
  description: "Build the canonical invoice or proforma data model without creating or storing a PDF.",
  inputSchema: { booking_id: z.string().uuid() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ booking_id }, ctx) => {
    const client = await requirePerm(ctx, PERM.finance);
    const [{ data: booking, error }, { data: items }, charges, payments, { data: roomRows }] = await Promise.all([
      client.from("bookings").select("*").eq("id", booking_id).maybeSingle(),
      client.from("booking_items" as any).select("*").eq("booking_id", booking_id).order("position"),
      listBookingCharges(booking_id, client),
      listBookingPayments(booking_id, client),
      client.from("rooms").select("id,room_number"),
    ]);
    if (error) throw error;
    if (!booking) throw new McpToolError("Booking not found or not visible to this user.");
    const numberByRoom = new Map((roomRows ?? []).map((r: any) => [r.id, r.room_number]));
    const roomLabels = Object.fromEntries(((items ?? []) as any[]).filter((i) => i.assigned_room_id).map((i) => [i.id, numberByRoom.get(i.assigned_room_id) ?? ""]));
    const doc = buildInvoiceDocument({ booking: booking as any, items: (items ?? []) as any, charges: charges as any, payments: payments as any, roomLabels });
    return ok({ invoice: { ...doc, guest: { name: doc.guest.name, phone: null, email: null }, signature: { url: null, designation: doc.signature.designation } } });
  }),
});