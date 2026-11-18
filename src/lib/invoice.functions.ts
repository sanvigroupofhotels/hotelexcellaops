import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadInvoiceData } from "@/lib/invoice-data";
import { invoiceBillingSchema } from "@/lib/invoice-billing";

export const getStaffInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ booking_id: z.string().uuid() }).parse(input))
  .handler(({ data, context }) => loadInvoiceData(context.supabase, data.booking_id));

export const updateInvoiceBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => invoiceBillingSchema.extend({ booking_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: booking, error } = await context.supabase.from("bookings")
      .select("customer_id").eq("id", data.booking_id).maybeSingle();
    if (error) throw error;
    if (!booking?.customer_id) throw new Error("Link a guest profile to this booking before editing billing details.");
    const patch = { company_name: data.company_name || null, gst_number: data.gst_number || null };
    const { data: customer, error: updateError } = await context.supabase.from("customers" as any)
      .update(patch).eq("id", booking.customer_id).select("company_name,gst_number,company_address").single();
    if (updateError) throw updateError;
    await context.supabase.rpc("log_activity" as any, {
      p_page: "Customers", p_action: "customer_updated", p_entity_type: "customer",
      p_entity_id: booking.customer_id, p_summary: "Invoice billing details updated",
      p_after: patch, p_source: "manual",
    } as any);
    return customer;
  });