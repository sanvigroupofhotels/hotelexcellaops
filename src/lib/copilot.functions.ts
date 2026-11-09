import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CopilotDraft = {
  guest_name?: string | null;
  phone?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  adults?: number | null;
  children?: number | null;
  room_type?: "Oak Room" | "Mapple Room" | null;
  rooms?: number | null;
  /** Per-night rate agreed with the guest (per room). */
  agreed_rate?: number | null;
  /** Whether agreed_rate already includes GST. */
  gst_included?: boolean | null;
};

export type CopilotTurn = { role: "user" | "assistant"; text: string };

/** Requested changes to an existing booking. All optional. */
export type CopilotUpdate = {
  target?: string | null; // guest name / phone / room / reference; null = active booking
  rate?: number | null; // per night, before tax
  early_time?: string | null; // HH:MM 24h expected arrival
  late_time?: string | null; // HH:MM 24h expected departure
  check_in?: string | null;
  check_out?: string | null;
};
/** Stay / billing action request. */
export type CopilotOp = { kind: "check_in" | "check_out" | "payment"; target?: string | null; amount?: number | null; mode?: string | null; utr?: string | null };
export type CopilotActive = { id: string; label: string } | null;

/**
 * Parses a front-desk conversation (EN / Telugu / Hindi) into a booking draft.
 * Read-only: never writes. The client shows a preview card and the booking is
 * created only through the canonical submitNewBooking pipeline after Confirm.
 */
export const copilotParse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { turns: CopilotTurn[]; today: string; draft: CopilotDraft | null; active?: CopilotActive }) => {
    if (!Array.isArray(d?.turns)) throw new Error("turns required");
    const a = d.active && typeof d.active.id === "string" ? { id: d.active.id, label: String(d.active.label).slice(0, 200) } : null;
    return { turns: d.turns.slice(-20).map((t) => ({ role: t.role, text: String(t.text).slice(0, 2000) })), today: String(d.today), draft: d.draft ?? null, active: a };
  })
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI not configured");
    const system = `You are HEOS, the front-desk booking assistant for Hotel Excella (Vizag). Today is ${data.today} (Asia/Kolkata).
Staff speak English, Telugu, Hindi or a mix. You either CREATE a new booking or UPDATE an existing one.
Active booking in this chat: ${data.active ? data.active.label : "none"}.
Decide intent:
- "update" when staff ask to change something on a booking (rate/price/tariff per night, early check-in time, late checkout time, check-in/check-out dates) — e.g. "update price to 2000", "add early check-in 9am", "late checkout 3pm", "for Ravi change checkout to 10th". Never create a new booking for these.
  update fields: target (guest name, phone, room number or booking reference mentioned; null if they mean the active booking), rate (number per night), early_time ("HH:MM" 24h), late_time ("HH:MM" 24h), check_in, check_out (YYYY-MM-DD). Only fill what was asked in the LATEST request.
  If there is no active booking and no target, ask which booking (guest name or mobile).
  Reply briefly, e.g. "Here are the changes. Tap Confirm to apply."
- "check_in" when staff want to check a guest in; "check_out" to check a guest out / settle and check out; "payment" to record/collect a payment or advance.
  op fields: target (guest name, phone, room number or reference; null = active booking), amount (number, payment only), mode ("Cash"|"UPI"|"Card"|"Bank Transfer", payment only), utr (string or null).
  Reply briefly, e.g. "Here's the check-in. Tap Confirm."
- "create" for new bookings. Before creating, if this guest was just booked in this chat, prefer update.
- "chat" for anything else.
For create:
Required: guest_name, phone (10-digit Indian mobile, digits only), check_in, check_out (YYYY-MM-DD, check_out after check_in; resolve "tomorrow", "Nov 5", "2 nights").
Also required: agreed_rate (the per-night, per-room price staff agreed with the guest, number) and gst_included (true if that price already includes GST, false if GST is extra). If agreed_rate is missing, ask "What rate did you agree per night with the guest, and does it include GST?". If only gst_included is unclear, ask whether it includes GST. If staff say "rack rate"/"standard rate", set agreed_rate to 0 and gst_included false.
Always reply in the same language the staff used (Telugu script for Telugu, Devanagari for Hindi).
Optional with defaults: adults (2), children (0), room_type ("Oak Room" default, or "Mapple Room"), rooms (1).
Current draft so far: ${JSON.stringify(data.draft ?? {})}. Merge new info into it; later messages override earlier values.
If something is missing or unclear (e.g. phone not 10 digits, ambiguous date), ask ONE short clarifying question in the staff's language.
If all required fields are present, reply with a one-line summary and say "Tap Confirm to create."
For "chat", briefly say you can create bookings, update rate/times/dates, check guests in or out, and record payments.
Return ONLY JSON: {"intent": "create"|"update"|"check_in"|"check_out"|"payment"|"chat", "reply": string, "draft": {guest_name, phone, check_in, check_out, adults, children, room_type, rooms, agreed_rate, gst_included}, "ready": boolean, "update": {target, rate, early_time, late_time, check_in, check_out} | null, "op": {target, amount, mode, utr} | null}. No markdown.`;
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "google/gemini-3.8-flash",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          ...data.turns.map((t) => ({ role: t.role, content: t.text })),
        ],
      }),
    });
    if (!res.ok) {
      console.error("copilot ai", res.status, (await res.text()).slice(0, 300));
      if (res.status === 429) return { reply: "I'm a bit busy — please try again in a moment.", draft: data.draft, ready: false };
      if (res.status === 402) return { reply: "AI credits are exhausted for now.", draft: data.draft, ready: false };
      return { reply: "Sorry, I couldn't process that. Please try again.", draft: data.draft, ready: false };
    }
    const json: any = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    try {
      const p = JSON.parse(text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
      const d: CopilotDraft = { ...(data.draft ?? {}), ...(p.draft ?? {}) };
      if (d.phone) d.phone = String(d.phone).replace(/\D/g, "").slice(-10);
      if (d.room_type !== "Mapple Room") d.room_type = "Oak Room";
      if (["check_in", "check_out", "payment"].includes(p.intent)) {
        const o = p.op ?? {};
        const modes = ["Cash", "UPI", "Card", "Bank Transfer"];
        const op: CopilotOp = {
          kind: p.intent, target: o.target ? String(o.target).slice(0, 80) : null,
          amount: Number(o.amount) > 0 ? Math.round(Number(o.amount)) : null,
          mode: modes.find((m) => m.toLowerCase() === String(o.mode ?? "").toLowerCase()) ?? null,
          utr: o.utr ? String(o.utr).slice(0, 60) : null,
        };
        return { intent: p.intent as CopilotOp["kind"], reply: String(p.reply ?? ""), draft: data.draft, ready: false, update: null, op };
      }
      const intent: "create" | "update" | "chat" = p.intent === "update" ? "update" : p.intent === "chat" ? "chat" : "create";
      if (intent === "update") {
        const u = p.update ?? {};
        const hm = (v: any) => (typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v) ? v.padStart(5, "0") : null);
        const ymd = (v: any) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
        const update: CopilotUpdate = {
          target: u.target ? String(u.target).slice(0, 80) : null,
          rate: Number(u.rate) > 0 ? Math.round(Number(u.rate)) : null,
          early_time: hm(u.early_time), late_time: hm(u.late_time),
          check_in: ymd(u.check_in), check_out: ymd(u.check_out),
        };
        return { intent, reply: String(p.reply ?? ""), draft: data.draft, ready: false, update };
      }
      if (d.agreed_rate != null) d.agreed_rate = Number(d.agreed_rate) >= 0 ? Math.round(Number(d.agreed_rate)) : null;
      if (d.gst_included != null) d.gst_included = d.gst_included === true || String(d.gst_included) === "true";
      const ready = intent === "create" && !!(d.guest_name && d.phone?.length === 10 && d.check_in && d.check_out && d.check_out > d.check_in) && d.agreed_rate != null && typeof d.gst_included === "boolean";
      return { intent, reply: String(p.reply ?? ""), draft: intent === "create" ? d : data.draft, ready, update: null as CopilotUpdate | null };
    } catch {
      return { reply: text || "Could you repeat that?", draft: data.draft, ready: false };
    }
  });
