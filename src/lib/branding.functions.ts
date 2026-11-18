import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gstinSchema } from "@/lib/invoice-billing";

const image = z.string().max(6_000_000).refine(
  (v) => !v || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)
    || /^https:\/\/[^\s]+$/.test(v) || /^\/__l5e\/assets-v1\/[^\s]+$/.test(v),
  "Use an uploaded image or a secure image URL.",
);
export const brandingSchema = z.object({
  name: z.string().trim().min(1).max(150), legal_name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(1000), gstin: gstinSchema,
  phone: z.string().trim().max(32), email: z.union([z.literal(""), z.email().max(255)]),
  website: z.string().trim().max(255), logo_url: image, signature_url: image,
  portal_title: z.string().trim().max(200), welcome_message: z.string().trim().max(2000),
  invoice_footer: z.string().trim().max(2000), signatory_designation: z.string().trim().max(200),
});
export const saveBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => brandingSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Existing app_settings write policies authorize the caller; never elevate.
    const { error } = await context.supabase.from("app_settings" as any)
      .upsert({ key: "branding", value: data, updated_at: new Date().toISOString() });
    if (error) throw error;
    return { ok: true };
  });