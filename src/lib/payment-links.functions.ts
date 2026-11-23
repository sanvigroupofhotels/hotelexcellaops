import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const EXPIRY = { "12h": 12, "24h": 24, "48h": 48, none: 0 } as const;

function auth() {
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw new Error("Razorpay is not configured");
  return "Basic " + btoa(`${id}:${secret}`);
}

export const createPaymentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    amount: z.number().min(1).max(1_000_000),
    guest_name: z.string().trim().min(1).max(100),
    phone: z.string().regex(/^\d{10}$/),
    purpose: z.string().trim().min(1).max(200),
    expiry: z.enum(["12h", "24h", "48h", "none"]),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("can_access_frontdesk_data" as any);
    if (!ok) throw new Error("Not allowed");
    const hrs = EXPIRY[data.expiry];
    const expireBy = hrs ? Math.floor(Date.now() / 1000) + hrs * 3600 : undefined;
    const res = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth() },
      body: JSON.stringify({
        amount: Math.round(data.amount * 100), currency: "INR", description: data.purpose,
        customer: { name: data.guest_name, contact: `+91${data.phone}` },
        notify: { sms: true, email: false }, reminder_enable: true,
        ...(expireBy ? { expire_by: expireBy } : {}),
        notes: { source: "heos_standalone" },
      }),
    });
    if (!res.ok) { console.error("Razorpay link error", await res.text()); throw new Error("Could not create payment link"); }
    const link = await res.json() as { id: string; short_url: string };
    const { data: row, error } = await context.supabase.from("payment_links" as any).insert({
      razorpay_link_id: link.id, short_url: link.short_url, amount: data.amount, guest_name: data.guest_name,
      phone: data.phone, purpose: data.purpose, expires_at: expireBy ? new Date(expireBy * 1000).toISOString() : null,
    }).select().single();
    if (error) throw new Error(error.message);
    return row as any;
  });

export type PaymentLinkRow = { id: string; razorpay_link_id: string; short_url: string; amount: number; guest_name: string; phone: string; purpose: string; status: string; expires_at: string | null; paid_at: string | null; created_at: string };

export const listPaymentLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("payment_links" as any).select("*").order("created_at", { ascending: false }).limit(30);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as PaymentLinkRow[];
    // Refresh open links from Razorpay so Paid/Expired status stays current.
    await Promise.all(rows.filter((r) => r.status === "Issued").slice(0, 10).map(async (r) => {
      try {
        const res = await fetch(`https://api.razorpay.com/v1/payment_links/${r.razorpay_link_id}`, { headers: { Authorization: auth() } });
        if (!res.ok) return;
        const l = await res.json() as { status: string; payments?: { payment_id: string }[] };
        const status = l.status === "paid" ? "Paid" : l.status === "expired" ? "Expired" : l.status === "cancelled" ? "Cancelled" : "Issued";
        if (status === r.status) return;
        const patch: Record<string, unknown> = { status };
        if (status === "Paid") { patch.paid_at = new Date().toISOString(); patch.razorpay_payment_id = l.payments?.[0]?.payment_id ?? null; }
        await context.supabase.from("payment_links" as any).update(patch).eq("id", r.id);
        Object.assign(r, patch);
      } catch { /* keep stored status */ }
    }));
    return rows;
  });
