import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Extract payment details from a UPI / payment-app screenshot using
 * Lovable AI Gateway (Gemini 2.5 Flash, vision).
 *
 * Input: bucket path of the uploaded screenshot (payment-screenshots bucket).
 * Output: best-effort JSON with amount, txn_id, date, time, app, payer_name,
 *         merchant_name, plus the raw model text for audit.
 *
 * The handler NEVER auto-saves anything. Caller (Add Payment modal) pre-fills
 * the form with the returned values; staff must verify & submit.
 */
export const extractPaymentDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { imagePath: string }) => {
    if (!data?.imagePath || typeof data.imagePath !== "string") {
      throw new Error("imagePath is required");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const gatewayKey = process.env.LOVABLE_API_KEY;
    if (!gatewayKey) throw new Error("LOVABLE_API_KEY not configured");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Pull bytes from the private bucket (server-side; service role can read).
    const dl = await supabaseAdmin.storage.from("payment-screenshots").download(data.imagePath);
    if (dl.error || !dl.data) {
      throw new Error(`Could not read screenshot: ${dl.error?.message ?? "not found"}`);
    }
    const buf = Buffer.from(await dl.data.arrayBuffer());
    const mime = dl.data.type || "image/jpeg";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

    const systemPrompt = `You extract payment details from screenshots of Indian UPI apps such as BharatPe, PhonePe, Google Pay (GPay), Paytm, Amazon Pay, etc.
Return ONLY a JSON object with these keys (omit a key if you cannot read it confidently):
{
  "amount": number,            // rupees, no symbol, no commas
  "txn_id": string,            // UTR / transaction reference
  "date": string,              // YYYY-MM-DD
  "time": string,              // HH:MM in 24h
  "app": string,               // PhonePe | GPay | Paytm | BharatPe | UPI | etc.
  "payer_name": string,
  "merchant_name": string,
  "raw_text": string           // any other useful text you can read
}
Do not invent values. Do not include markdown fences.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${gatewayKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: [
            { type: "text", text: "Extract payment details from this screenshot. Return JSON only." },
            { type: "image_url", image_url: { url: dataUrl } },
          ]},
        ],
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI extract failed (${res.status}): ${errText.slice(0, 200)}`);
    }
    const json: any = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";

    let parsed: Record<string, any> = {};
    try {
      const stripped = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
      parsed = JSON.parse(stripped);
    } catch {
      parsed = { raw_text: text };
    }

    return {
      extracted: parsed,
      raw_text: text,
      image_path: data.imagePath,
    };
  });
