import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { buildInvoiceDocument } from "@/lib/invoice-document";
import { loadInvoiceData } from "@/lib/invoice-data";
import { guarded, ok, PERM, requirePerm } from "../guard";

export default defineTool({
  name: "get_invoice_preview",
  title: "Get invoice preview",
  description: "Build the canonical invoice or proforma data model without creating or storing a PDF.",
  inputSchema: { booking_id: z.string().uuid() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: guarded(async ({ booking_id }, ctx) => {
    const client = await requirePerm(ctx, PERM.finance);
    const doc = buildInvoiceDocument(await loadInvoiceData(client, booking_id));
    return ok({ invoice: { ...doc, guest: { ...doc.guest, phone: null, email: null }, signature: { url: null, designation: doc.signature.designation } } });
  }),
});