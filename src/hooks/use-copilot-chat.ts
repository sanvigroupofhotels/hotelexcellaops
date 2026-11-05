import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { copilotParse, type CopilotDraft } from "@/lib/copilot.functions";
import { buildCopilotPreview, createCopilotBooking, type CopilotPreview } from "@/lib/copilot-booking";
import { toLocalYMD } from "@/lib/utils";

export type CopilotLang = "en-IN" | "te-IN" | "hi-IN";
export type CopilotMessage = {
  id: string; role: "user" | "assistant"; text: string; at: number;
  preview?: CopilotPreview; bookingId?: string; status?: "pending" | "created" | "dismissed";
};

const KEY = "heos-copilot-session-v1";

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Single active conversation, stored in this browser only. */
export function useCopilotChat() {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [draft, setDraft] = useState<CopilotDraft | null>(null);
  const [lang, setLang] = useState<CopilotLang>("en-IN");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<any>(null);
  const loaded = useRef(false);
  const parse = useServerFn(copilotParse);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.messages)) setMessages(s.messages);
        if (s.lang) setLang(s.lang);
        if (s.draft) setDraft(s.draft);
      }
    } catch {}
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try { localStorage.setItem(KEY, JSON.stringify({ messages, lang, draft })); } catch {}
  }, [messages, lang, draft]);

  const push = (m: Omit<CopilotMessage, "id" | "at">) =>
    setMessages((prev) => [...prev, { ...m, id: makeId(), at: Date.now() }]);

  const sendMessage = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || thinking) return;
    const user: CopilotMessage = { id: makeId(), role: "user", text: t, at: Date.now() };
    const history = [...messages, user].map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, user]);
    setThinking(true);
    try {
      const r = await parse({ data: { turns: history, today: toLocalYMD(), draft } });
      setDraft(r.draft ?? null);
      let preview: CopilotPreview | undefined;
      if (r.ready && r.draft) {
        try { preview = await buildCopilotPreview(r.draft); } catch (e: any) {
          push({ role: "assistant", text: `Couldn't check availability: ${e?.message ?? e}` });
        }
      }
      push({ role: "assistant", text: r.reply || (preview ? "Here's the booking. Tap Confirm to create." : "Okay."), preview, status: preview ? "pending" : undefined });
    } catch (e: any) {
      push({ role: "assistant", text: `Sorry, something went wrong: ${e?.message ?? "try again"}` });
    } finally {
      setThinking(false);
    }
  }, [messages, draft, thinking, parse]);

  const confirmPreview = useCallback(async (id: string) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg?.preview) return;
    const b = await createCopilotBooking(msg.preview);
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: "created", bookingId: b.id } : m)));
    setDraft(null);
    push({ role: "assistant", text: `Booking created for ${b.guest_name}.` });
    return b;
  }, [messages]);

  const dismissPreview = useCallback((id: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: "dismissed" } : m)));
  }, []);

  const clearSession = useCallback(() => { setMessages([]); setDraft(null); }, []);

  const speechSupported =
    typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const startListening = useCallback((onFinal: (t: string) => void) => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return false;
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e: any) => {
      let inter = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else inter += r[0].transcript;
      }
      setInterim(finalText + inter);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      if (finalText.trim()) onFinal(finalText.trim());
    };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
    return true;
  }, [lang]);

  const stopListening = useCallback(() => recRef.current?.stop(), []);

  return { messages, lang, setLang, listening, thinking, interim, sendMessage, confirmPreview, dismissPreview, clearSession, speechSupported, startListening, stopListening };
}
