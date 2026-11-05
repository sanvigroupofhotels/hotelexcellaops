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
};

export type CopilotTurn = { role: "user" | "assistant"; text: string };

/**
 * Parses a front-desk conversation (EN / Telugu / Hindi) into a booking draft.
 * Read-only: never writes. The client shows a preview card and the booking is
 * created only through the canonical submitNewBooking pipeline after Confirm.
 */
export const copilotParse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { turns: CopilotTurn[]; today: string; draft: CopilotDraft | null }) => {
    if (!Array.isArray(d?.turns)) throw new Error("turns required");
    return { turns: d.turns.slice(-20).map((t) => ({ role: t.role, text: String(t.text).slice(0, 2000) })), today: String(d.today), draft: d.draft ?? null };
  })
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI not configured");
    const system = `You are HEOS, the front-desk booking assistant for Hotel Excella (Vizag). Today is ${data.today} (Asia/Kolkata).
Staff speak English, Telugu, Hindi or a mix. Your job now: collect details to create a booking.
Required: guest_name, phone (10-digit Indian mobile, digits only), check_in, check_out (YYYY-MM-DD, check_out after check_in; resolve "tomorrow", "Nov 5", "2 nights").
Optional with defaults: adults (2), children (0), room_type ("Oak Room" default, or "Mapple Room"), rooms (1).
Current draft so far: ${JSON.stringify(data.draft ?? {})}. Merge new info into it; later messages override earlier values.
If something is missing or unclear (e.g. phone not 10 digits, ambiguous date), ask ONE short clarifying question in the staff's language.
If all required fields are present, reply with a one-line summary and say "Tap Confirm to create."
If the request is not about creating a booking, briefly say that only new bookings are supported in chat right now.
Return ONLY JSON: {"reply": string, "draft": {guest_name, phone, check_in, check_out, adults, children, room_type, rooms}, "ready": boolean}. No markdown.`;
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
      const ready = !!(d.guest_name && d.phone?.length === 10 && d.check_in && d.check_out && d.check_out > d.check_in);
      return { reply: String(p.reply ?? ""), draft: d, ready };
    } catch {
      return { reply: text || "Could you repeat that?", draft: data.draft, ready: false };
    }
  });
