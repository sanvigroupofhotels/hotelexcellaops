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

export type PaymentLinkRow = { id: string; booking_id?: string | null; razorpay_payment_id?: string | null; razorpay_link_id: string; short_url: string; amount: number; guest_name: string; phone: string; purpose: string; status: string; expires_at: string | null; paid_at: string | null; created_at: string };

export const listPaymentLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("payment_links" as any).select("*").order("created_at", { ascending: false }).limit(200);
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

async function requireFrontdesk(supabase: any) {
  const { data: ok } = await supabase.rpc("can_access_frontdesk_data" as any);
  if (!ok) throw new Error("Not allowed");
}

export const getPaymentLink = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFrontdesk(context.supabase);
    const { data: row, error } = await context.supabase.from("payment_links" as any).select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    return row as unknown as PaymentLinkRow & { booking_id: string | null; razorpay_payment_id: string | null };
  });

export const cancelPaymentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFrontdesk(context.supabase);
    const { data: row } = await context.supabase.from("payment_links" as any).select("razorpay_link_id,status").eq("id", data.id).single();
    const r = row as any;
    if (!r || r.status !== "Issued") throw new Error("Only open links can be cancelled");
    const res = await fetch(`https://api.razorpay.com/v1/payment_links/${r.razorpay_link_id}/cancel`, { method: "POST", headers: { Authorization: auth() } });
    if (!res.ok) { console.error("Razorpay cancel error", await res.text()); throw new Error("Could not cancel link (it may already be paid)"); }
    await context.supabase.from("payment_links" as any).update({ status: "Cancelled" }).eq("id", data.id);
    return { ok: true };
  });

/** Attach a paid link to a booking once and record it as a Razorpay receipt on that folio. */
export const linkPaymentLinkToBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), booking_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFrontdesk(context.supabase);
    const sb = context.supabase;
    const { data: bk } = await sb.from("bookings").select("id,customer_id,booking_reference").eq("id", data.booking_id).single();
    if (!bk) throw new Error("Booking not found");
    const { data: claimed, error } = await sb.from("payment_links" as any).update({ booking_id: data.booking_id })
      .eq("id", data.id).eq("status", "Paid").is("booking_id", null).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    const l = claimed as any;
    if (!l) throw new Error("Link is not paid or is already linked to a booking");
    const { error: payErr } = await sb.from("booking_payments" as any).insert({
      booking_id: data.booking_id, customer_id: (bk as any).customer_id ?? null, amount: l.amount, payment_mode: "Razorpay",
      collected_by: "Razorpay Payment Link", occurred_at: l.paid_at ?? new Date().toISOString(),
      utr: l.razorpay_payment_id ?? l.razorpay_link_id, notes: `Payment link · ${l.purpose}`, user_id: context.userId,
    });
    if (payErr) {
      await sb.from("payment_links" as any).update({ booking_id: null }).eq("id", data.id);
      throw new Error(payErr.message);
    }
    return { booking_reference: (bk as any).booking_reference as string };
  });

export const searchLinkableBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ q: z.string().trim().max(60) }).parse(i))
  .handler(async ({ data, context }) => {
    await requireFrontdesk(context.supabase);
    let q = context.supabase.from("bookings").select("id,booking_reference,guest_name,phone,check_in,check_out,status")
      .not("status", "in", "(Cancelled,No-Show,Draft)").order("check_in", { ascending: false }).limit(10);
    const term = data.q.replace(/[%,()]/g, "");
    if (term) q = q.or(`booking_reference.ilike.%${term}%,guest_name.ilike.%${term}%,phone.ilike.%${term}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
