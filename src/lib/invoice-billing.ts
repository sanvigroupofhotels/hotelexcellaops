import { z } from "zod";

export const gstinSchema = z.string().trim().toUpperCase().refine(
  (v) => !v || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v),
  "Enter a valid 15-character GSTIN, or leave it blank.",
);

export const invoiceBillingSchema = z.object({
  company_name: z.string().trim().max(200),
  gst_number: gstinSchema,
});

export interface InvoiceBilling {
  company_name: string | null;
  gst_number: string | null;
  company_address: string | null;
}