import { useEffect, useRef, useState } from "react";
import { BotMessageSquare, Loader2, Mic, MicOff, RotateCcw, Send } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCopilotChat, type CopilotLang, type CopilotMessage } from "@/hooks/use-copilot-chat";
import { toast } from "sonner";

const LANGS: { key: CopilotLang; label: string }[] = [
  { key: "en-IN", label: "EN" },
  { key: "te-IN", label: "తె" },
  { key: "hi-IN", label: "हि" },
];
const PILLS = ["Book for Ravi 9876543210 tomorrow for 2 nights", "New walk-in booking"];
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Track the visible area (shrinks when the mobile keyboard opens). */
function useVisualHeight() {
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setH(vv.height);
    on();
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    return () => { vv.removeEventListener("resize", on); vv.removeEventListener("scroll", on); };
  }, []);
  return h;
}

function PreviewCard({ m, onConfirm, onDismiss }: { m: CopilotMessage; onConfirm: () => Promise<void>; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false);
  const p = m.preview!;
  const d = p.draft;
  const short = p.available < d.rooms;
  return (
    <div className="mt-2 rounded-xl border border-border bg-card p-3 text-sm space-y-1.5">
      <div className="font-display text-base">{d.guest_name}</div>
      <div className="text-muted-foreground">+91 {d.phone}</div>
      <div>{d.check_in} → {d.check_out} · {p.nights} night{p.nights === 1 ? "" : "s"}</div>
      <div>{d.room_type} × {d.rooms} · {d.adults} adult{d.adults === 1 ? "" : "s"}{d.children ? ` · ${d.children} child` : ""}</div>
      <div>{inr(p.rate)}/night · Taxes {inr(p.taxes)}</div>
      <div className="font-semibold text-gold">Total {inr(p.total)}</div>
      <div className={short ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>{p.available} {d.room_type} available</div>
      {m.status === "created" && m.bookingId ? (
        <Link to="/bookings/$id" params={{ id: m.bookingId }} className="inline-block text-primary underline text-sm">Open booking</Link>
      ) : m.status === "dismissed" ? (
        <div className="text-xs text-muted-foreground">Dismissed</div>
      ) : (
        <div className="flex gap-2 pt-1">
          <Button size="sm" disabled={busy || short} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>
            {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />} Confirm & Create
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

export function CopilotDrawer() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const c = useCopilotChat();
  const qc = useQueryClient();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const vh = useVisualHeight();

  const toEnd = () => endRef.current?.scrollIntoView({ block: "end" });
  useEffect(() => { toEnd(); }, [c.messages, c.interim, c.thinking, vh]);

  const send = (t = draft) => { void c.sendMessage(t); setDraft(""); };

  const toggleMic = () => {
    if (c.listening) return c.stopListening();
    if (!c.startListening((t) => void c.sendMessage(t))) toast.error("Voice input isn't supported in this browser. Try Chrome.");
  };

  return (
    <>
      <button
        aria-label="Open HEOS Copilot"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 transition"
      >
        <BotMessageSquare className="h-6 w-6" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          onOpenAutoFocus={(e) => e.preventDefault()}
          style={vh ? { height: vh, top: window.visualViewport?.offsetTop ?? 0 } : undefined}
          className="w-full sm:max-w-md flex flex-col p-0 gap-0 h-[100dvh]"
        >
          <SheetHeader className="p-4 border-b border-border shrink-0">
            <SheetTitle className="font-display flex items-center gap-2">
              <BotMessageSquare className="h-5 w-5 text-gold" /> HEOS Copilot
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

          <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col">
            <div className="mt-auto space-y-3">
              {c.messages.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  <p className="mb-3">Type or tap the mic and speak in English, Telugu or Hindi. Give guest name, mobile, check-in and check-out.</p>
                  <div className="flex flex-wrap gap-2">
                    {PILLS.map((p) => (
                      <button key={p} onClick={() => send(p)} className="px-3 py-1.5 rounded-full border border-border text-xs hover:bg-muted text-left">{p}</button>
                    ))}
                  </div>
                </div>
              )}
              {c.messages.map((m) => (
                <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                  <div className={m.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-3 py-2 text-sm"
                    : "max-w-[95%] text-sm text-foreground"}>
                    {m.text}
                    {m.preview && (
                      <PreviewCard
                        m={m}
                        onDismiss={() => c.dismissPreview(m.id)}
                        onConfirm={async () => {
                          try {
                            await c.confirmPreview(m.id);
                            qc.invalidateQueries();
                            toast.success("Booking created");
                          } catch (e: any) { toast.error(e?.message ?? "Could not create booking"); }
                        }}
                      />
                    )}
                  </div>
                </div>
              ))}
              {c.thinking && <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Thinking…</div>}
              {c.interim && <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl px-3 py-2 text-sm border border-dashed border-border text-muted-foreground">{c.interim}…</div></div>}
              <div ref={endRef} />
            </div>
          </div>

          <div className="border-t border-border p-3 flex items-end gap-2 shrink-0">
            <Textarea ref={inputRef} rows={1} value={draft} placeholder="Ask HEOS…"
              onFocus={() => setTimeout(toEnd, 300)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="min-h-10 max-h-32 resize-none" />
            <Button size="icon" variant={c.listening ? "destructive" : "outline"} onClick={toggleMic} aria-label={c.listening ? "Stop recording" : "Speak"}>
              {c.listening ? <MicOff className="h-4 w-4 animate-pulse" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Button size="icon" onClick={() => send()} disabled={!draft.trim() || c.thinking} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
