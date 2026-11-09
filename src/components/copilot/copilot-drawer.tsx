import { useEffect, useRef, useState } from "react";
import { History, BotMessageSquare, Loader2, Mic, MicOff, RotateCcw, Send, Volume2, VolumeX } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCopilotChat, type CopilotLang, type CopilotMessage } from "@/hooks/use-copilot-chat";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { listRecentBookings, bookingLabel } from "@/lib/copilot-update";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import { Input } from "@/components/ui/input";

type StayOpts = { collectedBy?: string; rooms?: Record<string, string>; overrideDocs?: boolean; settleMode?: string };
const MODES = ["Cash", "UPI", "Card"];

function StayCard({ m, onConfirm, onDismiss, onOpen }: { m: CopilotMessage; onConfirm: (o: StayOpts) => Promise<void>; onDismiss: () => void; onOpen: () => void }) {
  const op = m.stay!;
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState(op.kind === "payment" ? String(op.amount || "") : "");
  const [mode, setMode] = useState(op.kind === "payment" ? op.mode : "Cash");
  const [utr, setUtr] = useState(op.kind === "payment" ? op.utr : "");
  const run = async (o: StayOpts) => { setBusy(true); try { await onConfirm(o); } finally { setBusy(false); } };
  const done = m.status === "applied", gone = m.status === "dismissed";
  const title = op.kind === "check_in" ? "Check-In" : op.kind === "check_out" ? "Check-Out" : "Record Payment";
  return (
    <div className="mt-2 rounded-xl border border-border bg-card p-3 text-sm space-y-2">
      <div className="text-xs uppercase tracking-wide text-gold">{title}</div>
      <div className="font-display text-base">{op.guest_name}</div>
      <div className="text-xs text-muted-foreground">{op.label}</div>
      {op.kind === "check_in" && (<>
        {op.items.map((it) => (
          <div key={it.id}>
            <div className="text-muted-foreground">{it.room_type}: {it.roomNumber ? <b className="text-foreground">Room {it.roomNumber}</b> : rooms[it.id] ? <b className="text-foreground">Room {it.options.find((o) => o.id === rooms[it.id])?.room_number}</b> : "pick a clean room"}</div>
            {!it.roomId && !done && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {it.options.length === 0 && <span className="text-xs text-destructive">No clean {it.room_type} free right now.</span>}
                {it.options.map((o) => (
                  <button key={o.id} onClick={() => setRooms({ ...rooms, [it.id]: o.id })}
                    className={`px-2.5 py-1 rounded-full border text-xs ${rooms[it.id] === o.id ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>{o.room_number}</button>
                ))}
              </div>
            )}
          </div>
        ))}
        {op.docsPending && <div className="text-xs rounded-md bg-destructive/10 text-destructive px-2 py-1">Guest ID documents are not uploaded yet.</div>}
      </>)}
      {op.kind === "check_out" && (<>
        <div>Rooms: {op.rooms.join(", ")}</div>
        <div className={op.balance > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}>{op.balance > 0 ? `Balance due ${inr(op.balance)}` : "No balance due"}</div>
        {op.blocker && <div className="text-xs text-destructive">{op.blocker}</div>}
      </>)}
      {op.kind === "payment" && !done && (<>
        <div className="text-xs text-muted-foreground">Balance due {inr(op.balance)}</div>
        <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} placeholder="Amount" />
        <div className="flex flex-wrap gap-1.5">
          {[...MODES, "Bank Transfer"].map((x) => (
            <button key={x} onClick={() => setMode(x)} className={`px-2.5 py-1 rounded-full border text-xs ${mode === x ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>{x}</button>
          ))}
        </div>
        {mode !== "Cash" && <Input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="UTR / reference (optional)" />}
      </>)}
      {done ? (
        <Link to="/bookings/$id" params={{ id: op.bookingId }} onClick={onOpen} className="inline-block text-primary underline text-sm">Open booking</Link>
      ) : gone ? (
        <div className="text-xs text-muted-foreground">Dismissed</div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          {op.kind === "check_in" && (() => {
            const ready = op.items.every((it) => it.roomId || rooms[it.id]);
            return (
              <Button size="sm" disabled={busy || !ready} onClick={() => run({ rooms, overrideDocs: op.docsPending })}>
                {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}{op.docsPending ? "Check In (skip ID)" : "Confirm Check-In"}
              </Button>
            );
          })()}
          {op.kind === "check_out" && !op.blocker && (op.balance > 0 ? MODES.map((x) => (
            <Button key={x} size="sm" disabled={busy} onClick={() => run({ settleMode: x })}>Pay {inr(op.balance)} {x} & Check Out</Button>
          )) : (
            <Button size="sm" disabled={busy} onClick={() => run({})}>{busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Confirm Check-Out</Button>
          ))}
          {op.kind === "payment" && (
            <Button size="sm" disabled={busy || !(Number(amount) > 0)} onClick={() => { (op as any).amount = Number(amount); (op as any).mode = mode; (op as any).utr = utr; void run({}); }}>
              {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Confirm {amount ? inr(Number(amount)) : ""} Payment
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

/** Open Copilot from anywhere, optionally targeting a booking. */
export function openCopilot(booking?: { id: string; label: string }) {
  window.dispatchEvent(new CustomEvent("heos-copilot-open", { detail: booking }));
}

const LANGS: { key: CopilotLang; label: string }[] = [
  { key: "en-IN", label: "EN" },
  { key: "te-IN", label: "తె" },
  { key: "hi-IN", label: "हि" },
];
const PILLS = ["Book for Ravi 9876543210 tomorrow for 2 nights", "Update price to 2000 per night", "Add late checkout at 3pm", "Check in Ravi", "Record 2000 UPI for Ravi", "Check out room 204"];
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

function UpdateCard({ m, onConfirm, onDismiss, onOpen }: { m: CopilotMessage; onConfirm: () => Promise<void>; onDismiss: () => void; onOpen: () => void }) {
  const [busy, setBusy] = useState(false);
  const u = m.update!;
  return (
    <div className="mt-2 rounded-xl border border-border bg-card p-3 text-sm space-y-1.5">
      <div className="font-display text-base">{u.guest_name}</div>
      {u.phone && <div className="text-muted-foreground">{u.phone}</div>}
      <div className="text-xs text-muted-foreground">{u.label}</div>
      {u.changes.map((c) => (
        <div key={c.label}><span className="text-muted-foreground">{c.label}:</span> <s className="text-muted-foreground">{c.from}</s> → <b>{c.to}</b></div>
      ))}
      {u.newTotal != null && <div className="font-semibold text-gold">Total {inr(u.oldTotal)} → {inr(u.newTotal)} (incl. GST, before extras)</div>}
      {m.status === "applied" ? (
        <Link to="/bookings/$id" params={{ id: u.bookingId }} onClick={onOpen} className="inline-block text-primary underline text-sm">Open booking</Link>
      ) : m.status === "dismissed" ? (
        <div className="text-xs text-muted-foreground">Dismissed</div>
      ) : (
        <div className="flex gap-2 pt-1">
          <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>
            {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />} Confirm Update
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

function PreviewCard({ m, onConfirm, onDismiss, onOpen }: { m: CopilotMessage; onConfirm: () => Promise<void>; onDismiss: () => void; onOpen: () => void }) {
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
      <div>{inr(p.rate)}/night{p.totalOverride != null ? (p.taxesIncluded ? " (incl. GST)" : " + GST") : " (rack)"} · Taxes {inr(p.taxes)}</div>
      <div className="font-semibold text-gold">Total {inr(p.total)}</div>
      <div className={short ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>{p.available} {d.room_type} available</div>
      {m.status === "created" && m.bookingId ? (
        <Link to="/bookings/$id" params={{ id: m.bookingId }} onClick={onOpen} className="inline-block text-primary underline text-sm">Open booking</Link>
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
  const staff = useCurrentStaff();
  const qc = useQueryClient();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const vh = useVisualHeight();
  const [showRecent, setShowRecent] = useState(false);
  const recent = useQuery({ queryKey: ["copilot-recent"], queryFn: listRecentBookings, enabled: open && showRecent });
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { id: string; label: string } | undefined;
      if (d) c.setActiveBooking(d.id, d.label);
      setOpen(true);
    };
    window.addEventListener("heos-copilot-open", on);
    return () => window.removeEventListener("heos-copilot-open", on);
  }, [c.setActiveBooking]);

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
              <Button size="icon" variant="ghost" className="ml-auto h-7 w-7" aria-label={c.voiceOn ? "Mute voice replies" : "Speak replies"}
                onClick={() => { if (c.voiceOn) window.speechSynthesis?.cancel(); c.setVoiceOn(!c.voiceOn); }}>
                {c.voiceOn ? <Volume2 className="h-4 w-4 text-gold" /> : <VolumeX className="h-4 w-4" />}
              </Button>
              <Button size="sm" variant={showRecent ? "secondary" : "ghost"} className="h-7 text-xs px-2" onClick={() => setShowRecent(!showRecent)}>
                <History className="h-3.5 w-3.5 mr-1" /> Recent
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={c.clearSession}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> New Session
              </Button>
            </div>
            {c.active && <div className="text-xs text-muted-foreground pt-1 truncate">Working on: <span className="text-foreground">{c.active.label}</span></div>}
            {showRecent && (
              <div className="mt-2 max-h-64 overflow-y-auto space-y-1.5 text-left">
                {recent.isLoading && <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>}
                {recent.data?.map((b) => (
                  <button key={b.id} onClick={() => { c.setActiveBooking(b.id, bookingLabel(b)); setShowRecent(false); toast.success(`Now working on ${b.guest_name}`); }}
                    className={`w-full text-left rounded-lg border px-3 py-2 hover:bg-muted ${c.active?.id === b.id ? "border-gold" : "border-border"}`}>
                    <div className="text-sm font-medium flex justify-between gap-2"><span className="truncate">{b.guest_name}</span><span>{inr(Number(b.amount) || 0)}</span></div>
                    <div className="text-xs text-muted-foreground">{String(b.check_in).slice(0, 10)} → {String(b.check_out).slice(0, 10)}{b.room_details ? ` · ${b.room_details}` : ""} · {b.status}</div>
                  </button>
                ))}
                {recent.data?.length === 0 && <div className="text-xs text-muted-foreground">No bookings yet.</div>}
              </div>
            )}
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
                    {m.role === "assistant" && m.text && (
                      <button aria-label="Listen" onClick={() => c.speak(m.text)} className="ml-1.5 inline-flex items-center gap-1 align-middle text-xs text-muted-foreground hover:text-gold">
                        <Volume2 className="h-3.5 w-3.5" /> Listen
                      </button>
                    )}
                    {m.preview && (
                      <PreviewCard
                        m={m}
                        onDismiss={() => c.dismissPreview(m.id)}
                        onOpen={() => setOpen(false)}
                        onConfirm={async () => {
                          try {
                            await c.confirmPreview(m.id);
                            qc.invalidateQueries();
                            toast.success("Booking created");
                          } catch (e: any) { toast.error(e?.message ?? "Could not create booking"); }
                        }}
                      />
                    )}
                    {m.update && (
                      <UpdateCard
                        m={m}
                        onDismiss={() => c.dismissPreview(m.id)}
                        onOpen={() => setOpen(false)}
                        onConfirm={async () => {
                          try { await c.confirmUpdate(m.id); toast.success("Booking updated"); }
                          catch (e: any) { toast.error(e?.message ?? "Could not update booking"); }
                        }}
                      />
                    )}
                    {m.stay && (
                      <StayCard
                        m={m}
                        onDismiss={() => c.dismissPreview(m.id)}
                        onOpen={() => setOpen(false)}
                        onConfirm={async (o) => {
                          try { await c.confirmStay(m.id, { ...o, collectedBy: staff.name || "Front Desk" }); toast.success("Done"); }
                          catch (e: any) { toast.error(e?.message ?? "Could not complete that"); }
                        }}
                      />
                    )}
                    {m.matches && (
                      <div className="mt-2 space-y-1.5">
                        {m.matches.map((b) => (
                          <button key={b.id} disabled={m.status === "applied"} onClick={() => void c.pickMatch(m.id, b)}
                            className="w-full text-left rounded-lg border border-border bg-card px-3 py-2 hover:bg-muted disabled:opacity-80">
                            <div className="font-medium">{b.guest_name} <span className="text-xs text-muted-foreground">{b.booking_reference}</span></div>
                            <div className="text-xs text-muted-foreground">{b.phone ?? "No phone"} · {String(b.check_in).slice(0, 10)} → {String(b.check_out).slice(0, 10)}{b.roomNumbers?.length ? ` · Room ${b.roomNumbers.join(", ")}` : ""} · {b.status}</div>
                          </button>
                        ))}
                      </div>
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
