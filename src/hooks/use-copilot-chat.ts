import { useCallback, useEffect, useRef, useState } from "react";

export type CopilotLang = "en-IN" | "te-IN" | "hi-IN";
export type CopilotMessage = { id: string; role: "user" | "assistant"; text: string; at: number };

const KEY = "heos-copilot-session-v1";

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Single active conversation, stored in this browser only. */
export function useCopilotChat() {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [lang, setLang] = useState<CopilotLang>("en-IN");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<any>(null);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.messages)) setMessages(s.messages);
        if (s.lang) setLang(s.lang);
      }
    } catch {}
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try { localStorage.setItem(KEY, JSON.stringify({ messages, lang })); } catch {}
  }, [messages, lang]);

  const sendMessage = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    const user: CopilotMessage = { id: makeId(), role: "user", text: t, at: Date.now() };
    const reply: CopilotMessage = {
      id: makeId(),
      role: "assistant",
      text: "Noted. Booking actions from chat are coming in the next update — for now I'm capturing your request.",
      at: Date.now(),
    };
    setMessages((m) => [...m, user, reply]);
  }, []);

  const clearSession = useCallback(() => setMessages([]), []);

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

  return { messages, lang, setLang, listening, interim, sendMessage, clearSession, speechSupported, startListening, stopListening };
}
