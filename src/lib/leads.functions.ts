/**
 * CRM / Leads — server functions.
 *
 * Authoritative source for lead reads/writes.
 *
 * Public (no auth, used by Booking Engine):
 *   - upsertLeadFromBookingEngine
 *   - touchLead
 *
 * Authenticated (PMS users):
 *   - listLeads
 *   - getLead
 *   - listLeadActivities
 *   - updateLead
 *   - markLeadLost
 *   - reopenLead
 *
 * The phone column is UNIQUE on leads. Every "new inquiry" becomes a touch on
 * the existing row — including reopening a Lost lead back to Interested.
 * History lives in lead_activities only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeOrThrow } from "@/lib/phone";

// ---------------------------------------------------------------------------
// Internal: email dispatcher (best-effort).
// Records every notification into crm_outbound_emails and marks it 'sent' or
// 'skipped'. Actual SMTP/Resend wiring can be enabled later — table is the
// source of truth for what would be sent.
// ---------------------------------------------------------------------------
async function dispatchCrmEmail(opts: {
  leadId: string | null;
  event: "lead_created" | "lead_abandoned" | "lead_converted" | "lead_lost" | "lead_reopened";
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Read CRM settings for recipients + per-event toggles
  const { data: row } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", "crm").maybeSingle();
  const cfg = (row?.value as any) ?? {};
  const toggleByEvent: Record<string, string> = {
    lead_created: "notify_on_lead",
    lead_abandoned: "notify_on_abandon",
    lead_converted: "notify_on_converted",
    lead_lost: "notify_on_lost",
    lead_reopened: "notify_on_lead",
  };
  const toggle = toggleByEvent[opts.event];
  const enabled = toggle ? cfg[toggle] !== false : true;

  const recipients: string[] = Array.isArray(cfg.notify_reception_emails)
    ? cfg.notify_reception_emails.filter((s: any) => typeof s === "string" && s.includes("@"))
    : [];
  // Always include the default sentinel if list is empty
  if (recipients.length === 0) recipients.push("hotelexcellaoperations@gmail.com");

  await supabaseAdmin.from("crm_outbound_emails").insert({
    lead_id: opts.leadId,
    event: opts.event,
    recipients,
    subject: opts.subject,
    body_text: opts.bodyText,
    body_html: opts.bodyHtml ?? null,
    status: enabled ? "queued" : "skipped",
  });

  // Note: actual outbound delivery (Resend / SMTP) is wired separately.
  // Records remain status='queued' until the delivery worker is connected.
}

function leadHumanSummary(l: any): string {
  const lines: string[] = [];
  lines.push(`Name : ${l.guest_name}`);
  lines.push(`Phone: ${l.phone}`);
  if (l.email) lines.push(`Email: ${l.email}`);
  if (l.check_in || l.check_out) lines.push(`Stay : ${l.check_in ?? "?"} → ${l.check_out ?? "?"}`);
  if (l.room_type_name) lines.push(`Room : ${l.room_type_name}`);
  if (l.adults || l.children) lines.push(`Guests: ${l.adults ?? 0} adults, ${l.children ?? 0} children`);
  if (l.estimated_total != null) lines.push(`Estimate: ₹${Number(l.estimated_total).toLocaleString("en-IN")}`);
  lines.push(`Source: ${l.source_channel ?? "BookingEngine"}`);
  lines.push(`Status: ${l.status}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// upsertLeadFromBookingEngine  (PUBLIC, called from Booking Engine Step A)
//
// One row per mobile. If a row exists for this phone:
//   - If status = Lost  → reopen to Interested
//   - Otherwise         → update fields, refresh last_activity_at
// Triggers an email notification on every new lead OR reopened lead.
// ---------------------------------------------------------------------------
export const upsertLeadFromBookingEngine = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      guest_name: z.string().trim().min(2),
      phone: z.string().trim().min(8),
      email: z.string().trim().email().optional().or(z.literal("")),
      check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      adults: z.number().int().min(0).max(20).optional(),
      children: z.number().int().min(0).max(20).optional(),
      rooms: z.number().int().min(1).max(10).optional(),
      room_type_name: z.string().trim().optional(),
      estimated_total: z.number().nonnegative().optional(),
      notes: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const phone = normalizeOrThrow(data.phone);

    const { data: existing } = await supabaseAdmin
      .from("leads").select("*").eq("phone", phone).maybeSingle();

    const patch = {
      guest_name: data.guest_name,
      email: data.email || null,
      check_in: data.check_in ?? null,
      check_out: data.check_out ?? null,
      adults: data.adults ?? null,
      children: data.children ?? null,
      rooms: data.rooms ?? null,
      room_type_name: data.room_type_name ?? null,
      estimated_total: data.estimated_total ?? null,
      notes: data.notes ?? null,
      source_channel: "BookingEngine",
      last_activity_at: new Date().toISOString(),
    } as any;

    if (existing) {
      // If Converted, don't reopen — guest already has a booking.
      // Just refresh fields without changing status.
      if (existing.status === "Converted") {
        await supabaseAdmin.from("leads").update({ ...patch }).eq("id", existing.id);
        return { lead_id: existing.id as string, status: existing.status as string, reopened: false };
      }
      // If Lost → reopen to Interested. Otherwise keep current status.
      const reopen = existing.status === "Lost";
      const next: any = { ...patch };
      if (reopen) {
        next.status = "Interested";
        next.lost_at = null;
        next.lost_reason = null;
        next.abandoned_at = null;
      } else if (existing.status === "Abandoned") {
        next.status = "Interested";
        next.abandoned_at = null;
      }
      await supabaseAdmin.from("leads").update(next).eq("id", existing.id);
      // Fire email if reopened
      if (reopen) {
        const { data: lead } = await supabaseAdmin.from("leads").select("*").eq("id", existing.id).single();
        await dispatchCrmEmail({
          leadId: existing.id,
          event: "lead_reopened",
          subject: `Lead reopened — ${data.guest_name} (${phone})`,
          bodyText: `Previously Lost lead is interested again.\n\n${leadHumanSummary(lead)}`,
        });
      }
      return { lead_id: existing.id as string, status: (next.status ?? existing.status) as string, reopened: reopen };
    }

    // Insert new lead
    const { data: created, error } = await supabaseAdmin
      .from("leads")
      .insert({
        guest_name: data.guest_name,
        phone,
        ...patch,
        status: "Interested",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await dispatchCrmEmail({
      leadId: created.id,
      event: "lead_created",
      subject: `New lead — ${data.guest_name} (${phone})`,
      bodyText: `A new guest started a booking inquiry.\n\n${leadHumanSummary(created)}`,
    });

    return { lead_id: created.id as string, status: "Interested", reopened: false };
  });

// ---------------------------------------------------------------------------
// touchLead  (PUBLIC) — refresh last_activity_at on existing lead
// ---------------------------------------------------------------------------
export const touchLead = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ phone: z.string().trim().min(8) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const phone = normalizeOrThrow(data.phone);
    await supabaseAdmin
      .from("leads")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("phone", phone);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// listLeads (auth) — for Customers tabs
// ---------------------------------------------------------------------------
export const listLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("leads")
      .select("*")
      .order("last_activity_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("leads").select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listLeadActivities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ lead_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("lead_activities").select("*")
      .eq("lead_id", data.lead_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listLeadActivitiesByCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ customer_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: leads } = await context.supabase
      .from("leads").select("id").eq("customer_id", data.customer_id);
    const ids = (leads ?? []).map((l: any) => l.id);
    if (ids.length === 0) return [];
    const { data: rows, error } = await context.supabase
      .from("lead_activities").select("*")
      .in("lead_id", ids)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const markLeadLost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), reason: z.string().trim().min(1).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("leads")
      .update({ status: "Lost", lost_at: new Date().toISOString(), lost_reason: data.reason })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    const { data: lead } = await context.supabase.from("leads").select("*").eq("id", data.id).single();
    if (lead) {
      await dispatchCrmEmail({
        leadId: data.id,
        event: "lead_lost",
        subject: `Lead marked Lost — ${lead.guest_name}`,
        bodyText: `Reason: ${data.reason}\n\n${leadHumanSummary(lead)}`,
      });
    }
    return { ok: true };
  });

export const reopenLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("leads")
      .update({
        status: "Interested", lost_at: null, lost_reason: null, abandoned_at: null,
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      id: z.string().uuid(),
      guest_name: z.string().trim().min(1).optional(),
      email: z.string().trim().email().nullable().optional(),
      check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      adults: z.number().int().nullable().optional(),
      children: z.number().int().nullable().optional(),
      rooms: z.number().int().nullable().optional(),
      room_type_name: z.string().nullable().optional(),
      estimated_total: z.number().nullable().optional(),
      notes: z.string().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("leads")
      .update({ ...patch, last_activity_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// CRM Settings
// ---------------------------------------------------------------------------
export const getCrmSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("app_settings").select("value").eq("key", "crm").maybeSingle();
    const v: any = data?.value ?? {};
    return {
      abandon_minutes: Number(v.abandon_minutes ?? 10),
      notify_reception_emails: Array.isArray(v.notify_reception_emails)
        ? v.notify_reception_emails : ["hotelexcellaoperations@gmail.com"],
      notify_on_lead: v.notify_on_lead !== false,
      notify_on_abandon: v.notify_on_abandon !== false,
      notify_on_converted: v.notify_on_converted === true,
      notify_on_lost: v.notify_on_lost === true,
    };
  });

export const updateCrmSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      abandon_minutes: z.number().int().min(1).max(1440),
      notify_reception_emails: z.array(z.string().email()).max(20),
      notify_on_lead: z.boolean(),
      notify_on_abandon: z.boolean(),
      notify_on_converted: z.boolean(),
      notify_on_lost: z.boolean(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("app_settings")
      .upsert({ key: "crm", value: data as any }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
