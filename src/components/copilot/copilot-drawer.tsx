import { useEffect, useRef, useState } from "react";
import { BellRing, Mic, MicOff, RotateCcw, Send } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCopilotChat, type CopilotLang } from "@/hooks/use-copilot-chat";
import { toast } from "sonner";

const LANGS: { key: CopilotLang; label: string }[] = [
  { key: "en-IN", label: "EN" },
  { key: "te-IN", label: "తె" },
  { key: "hi-IN", label: "हि" },
];
const PILLS = ["New walk-in booking", "Today's departures", "Room 204 status"];

export function CopilotDrawer() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const c = useCopilotChat();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [c.messages, c.interim]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);

  const send = (t = draft) => { c.sendMessage(t); setDraft(""); inputRef.current?.focus(); };

  const toggleMic = () => {
    if (c.listening) return c.stopListening();
    if (!c.startListening((t) => c.sendMessage(t))) toast.error("Voice input isn't supported in this browser. Try Chrome.");
  };

  return (
    <>
      <button
        aria-label="Open HEOS Copilot"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 transition"
      >
        <BellRing className="h-6 w-6" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0 gap-0">
          <SheetHeader className="p-4 border-b border-border">
            <SheetTitle className="font-display flex items-center gap-2">
              <BellRing className="h-5 w-5 text-gold" /> HEOS Copilot
            </SheetTitle>
            <div className="flex items-center gap-2 pt-1">
              {LANGS.map((l) => (
                <button key={l.key} onClick={() => c.setLang(l.key)}
                  className={`px-2.5 py-1 rounded-full text-xs border ${c.lang === l.key ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}>
                  {l.label}
                </button>
              ))}
              <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={c.clearSession}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> New Session
              </Button>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {c.messages.length === 0 && (
              <div className="text-sm text-muted-foreground">
                <p className="mb-3">Type or tap the mic and speak in English, Telugu or Hindi.</p>
                <div className="flex flex-wrap gap-2">
                  {PILLS.map((p) => (
                    <button key={p} onClick={() => send(p)} className="px-3 py-1.5 rounded-full border border-border text-xs hover:bg-muted">{p}</button>
                  ))}
                </div>
              </div>
            )}
            {c.messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                <div className={m.role === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-3 py-2 text-sm"
                  : "max-w-[90%] text-sm text-foreground"}>
                  {m.text}
                </div>
              </div>
            ))}
            {c.interim && <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl px-3 py-2 text-sm border border-dashed border-border text-muted-foreground">{c.interim}…</div></div>}
            <div ref={endRef} />
          </div>

          <div className="border-t border-border p-3 flex items-end gap-2">
            <Textarea ref={inputRef} rows={1} value={draft} placeholder="Ask HEOS…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="min-h-10 max-h-32 resize-none" />
            <Button size="icon" variant={c.listening ? "destructive" : "outline"} onClick={toggleMic} aria-label={c.listening ? "Stop recording" : "Speak"}>
              {c.listening ? <MicOff className="h-4 w-4 animate-pulse" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Button size="icon" onClick={() => send()} disabled={!draft.trim()} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
