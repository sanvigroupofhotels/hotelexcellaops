import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { copilotParse, type CopilotDraft, type CopilotActive, type CopilotUpdate } from "@/lib/copilot.functions";
import { buildUpdatePreview, applyCopilotUpdate, findCopilotMatches, bookingLabel, type CopilotMatch, type CopilotUpdatePreview } from "@/lib/copilot-update";
import { useQueryClient } from "@tanstack/react-query";
import { buildCopilotPreview, createCopilotBooking, type CopilotPreview } from "@/lib/copilot-booking";
import { toLocalYMD } from "@/lib/utils";

export type CopilotLang = "en-IN" | "te-IN" | "hi-IN";
export type CopilotMessage = {
  id: string; role: "user" | "assistant"; text: string; at: number;
  preview?: CopilotPreview; bookingId?: string; status?: "pending" | "created" | "dismissed" | "applied";
  update?: CopilotUpdatePreview; matches?: CopilotMatch[]; pendingUpdate?: CopilotUpdate;
};

const KEY = "heos-copilot-session-v1";

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Single active conversation, stored in this browser only. */
export function useCopilotChat() {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [draft, setDraft] = useState<CopilotDraft | null>(null);
  const [active, setActive] = useState<CopilotActive>(null);
  const qc = useQueryClient();
  const [lang, setLang] = useState<CopilotLang>("en-IN");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<any>(null);
  const loaded = useRef(false);
  const parse = useServerFn(copilotParse);
  const [voiceOn, setVoiceOn] = useState(false);
  const langRef = useRef(lang); langRef.current = lang;
  const voiceRef = useRef(voiceOn); voiceRef.current = voiceOn;

  /** Browser text-to-speech in the selected language. */
  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) return;
    const ss = window.speechSynthesis;
    ss.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ""));
    const l = langRef.current;
    u.lang = l;
    const v = ss.getVoices().find((x) => x.lang === l) ?? ss.getVoices().find((x) => x.lang.startsWith(l.slice(0, 2)));
    if (v) u.voice = v;
    ss.speak(u);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.messages)) setMessages(s.messages);
        if (s.lang) setLang(s.lang);
        if (s.draft) setDraft(s.draft);
        if (s.active) setActive(s.active);
        if (typeof s.voiceOn === "boolean") setVoiceOn(s.voiceOn);
      }
    } catch {}
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try { localStorage.setItem(KEY, JSON.stringify({ messages, lang, draft, active, voiceOn })); } catch {}
  }, [messages, lang, draft, active, voiceOn]);

  const push = (m: Omit<CopilotMessage, "id" | "at">) => {
    setMessages((prev) => [...prev, { ...m, id: makeId(), at: Date.now() }]);
    if (m.role === "assistant" && voiceRef.current) speak(m.text);
  };

  const sendMessage = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || thinking) return;
    const user: CopilotMessage = { id: makeId(), role: "user", text: t, at: Date.now() };
    const history = [...messages, user].map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, user]);
    setThinking(true);
    try {
      const r: any = await parse({ data: { turns: history, today: toLocalYMD(), draft, active } });
      if (r.intent === "update" && r.update) {
        await runUpdate(r.update, r.reply);
        return;
      }
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
  }, [messages, draft, active, thinking, parse]);

  /** Resolve target booking, then show an update preview card. */
  const runUpdate = async (u: CopilotUpdate, reply?: string) => {
    let id = active?.id ?? null;
    if (u.target) {
      const m = await findCopilotMatches(u.target);
      if (m.length === 0) { push({ role: "assistant", text: `I couldn't find an open booking for "${u.target}".` }); return; }
      if (m.length > 1) { push({ role: "assistant", text: "Which booking? Tap one:", matches: m, pendingUpdate: u }); return; }
      id = m[0].id;
    }
    if (!id) { push({ role: "assistant", text: "Which booking should I change? Tell me the guest name or mobile number." }); return; }
    try {
      const pv = await buildUpdatePreview(id, u);
      setActive({ id, label: pv.label });
      push({ role: "assistant", text: reply || "Here are the changes. Tap Confirm to apply.", update: pv, status: "pending" });
    } catch (e: any) { push({ role: "assistant", text: e?.message ?? "Couldn't prepare that change." }); }
  };

  const pickMatch = useCallback(async (msgId: string, b: CopilotMatch) => {
    const msg = messages.find((m) => m.id === msgId);
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, matches: [b], status: "applied" } : m)));
    setActive({ id: b.id, label: bookingLabel(b) });
    if (!msg?.pendingUpdate) return;
    setThinking(true);
    try {
      const pv = await buildUpdatePreview(b.id, { ...msg.pendingUpdate, target: null });
      push({ role: "assistant", text: "Here are the changes. Tap Confirm to apply.", update: pv, status: "pending" });
    } catch (e: any) { push({ role: "assistant", text: e?.message ?? "Couldn't prepare that change." }); }
    finally { setThinking(false); }
  }, [messages]);

  const confirmUpdate = useCallback(async (id: string) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg?.update) return;
    await applyCopilotUpdate(msg.update, qc);
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: "applied", bookingId: msg.update!.bookingId } : m)));
    push({ role: "assistant", text: `Updated ${msg.update.guest_name}'s booking.` });
  }, [messages, qc]);

  const confirmPreview = useCallback(async (id: string) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg?.preview) return;
    const b = await createCopilotBooking(msg.preview);
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: "created", bookingId: b.id } : m)));
    setDraft(null);
    setActive({ id: b.id, label: bookingLabel(b as any) });
    push({ role: "assistant", text: `Booking created for ${b.guest_name}. You can now ask me to change its rate, early check-in, late checkout or dates.` });
    return b;
  }, [messages]);

  const dismissPreview = useCallback((id: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: "dismissed" } : m)));
  }, []);

  const clearSession = useCallback(() => { setMessages([]); setDraft(null); setActive(null); }, []);

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

  return { voiceOn, setVoiceOn, speak, messages, lang, setLang, listening, thinking, interim, sendMessage, confirmPreview, dismissPreview, confirmUpdate, pickMatch, clearSession, speechSupported, startListening, stopListening };
}
