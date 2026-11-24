import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, AlertTriangle, MessageSquareText, Archive, ChevronDown, Copy, Save, Link2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Topbar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { listLeads, markLeadLost, listLeadActivities, addInboxActivity } from "@/lib/leads.functions";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEAD_STAGES, directOfferAmount } from "@/lib/whatsapp-inbox-tools";
import { getBooking } from "@/lib/bookings-api";
import { issueBookingToken } from "@/lib/portal.functions";
import { paymentLinkMessage } from "@/lib/booking-messages";
import { checkBookingDuplicates } from "@/lib/booking-duplicates-api";
import { waLink } from "@/lib/whatsapp-pitch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/whatsapp-inbox")({
  head: () => ({ meta: [
    { title: "WhatsApp Inbox — Hotel Excella" },
    { name: "description", content: "Live guest booking enquiries with quick WhatsApp replies." },
    { property: "og:title", content: "WhatsApp Inbox — Hotel Excella" },
    { property: "og:description", content: "Live guest booking enquiries with quick WhatsApp replies." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: WhatsAppInbox,
});

type Lead = Awaited<ReturnType<typeof listLeads>>[number];
const LIVE = ["Interested", "Abandoned"];
const roomSummary = (lead: Lead) => lead.room_type_name?.includes("×") ? lead.room_type_name : `${lead.room_type_name ?? "Room"} × ${lead.rooms ?? 1}`;

const isMobile = () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function templates(l: Lead, offer: number | null = null) {
  const name = l.guest_name?.split(" ")[0] ?? "";
  const stay = l.check_in ? ` for ${l.check_in} to ${l.check_out}` : "";
  return [
    { key: "quote", label: "Rate Quote", text: `Hello ${name}, thank you for your enquiry at Hotel Excella${stay}. ${roomSummary(l)}${offer ? `: Special Direct Price ₹${offer.toLocaleString("en-IN")} incl. taxes` : l.estimated_total ? `: ₹${Number(l.estimated_total).toLocaleString("en-IN")} incl. taxes` : ""}. ${l.booking_id ? "Your reservation is recorded; please reply to confirm your arrival." : "Reply to confirm and we will hold your room."}` },
    { key: "location", label: "Location", text: `Hello ${name}, Hotel Excella, Visakhapatnam. Directions: https://maps.google.com/?q=Hotel+Excella+Visakhapatnam . Call reception: +91 9985908131.` },
    { key: "custom", label: "Custom", text: `Hello ${name}, ` },
  ];
}

function WhatsAppInbox() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"live" | "history">("live");
  const [selId, setSelId] = useState<string | null>(null);
  const leads = useQuery({ queryKey: ["leads"], queryFn: () => listLeads(), refetchInterval: 15000 });
  const rows = useMemo(() => (leads.data ?? []).filter((l) => (tab === "live") === LIVE.includes(l.status)), [leads.data, tab]);
  const sel = selId === "__none__" ? null : rows.find((l) => l.id === selId) ?? rows[0] ?? null;

  return (
    <div>
      <Topbar title="WhatsApp Inbox" subtitle="Guest booking enquiries" />
      <div className="px-4 md:px-8 py-6 max-w-[1400px] space-y-4">
        <div className="flex gap-2">
          {(["live", "history"] as const).map((t) => (
            <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => { setTab(t); setSelId(null); }}>
              {t === "live" ? "Live Requests" : "History"}
            </Button>
          ))}
        </div>
        <div className="grid md:grid-cols-[360px_1fr] gap-4">
          <div className="luxe-card rounded-xl divide-y divide-border md:max-h-[70vh] md:overflow-auto">
            {leads.isLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
            {!leads.isLoading && rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">No enquiries here.</p>}
            {rows.map((l) => {
              const open = sel?.id === l.id;
              return (
              <div key={l.id}>
              <Button variant="ghost" aria-expanded={open} onClick={() => setSelId(open && isMobile() ? "__none__" : l.id)} className={cn("w-full h-auto block rounded-none text-left p-3 whitespace-normal hover:bg-muted/50", open && "bg-muted")}>
                <div className="flex justify-between gap-2">
                  <span className="font-medium truncate">{l.guest_name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{ago(l.last_activity_at)}</span>
                </div>
                <div className="text-xs text-muted-foreground">{l.phone} · {l.source_channel}</div>
                <div className="text-xs mt-1 flex justify-between">
                  <span>{l.check_in ? `${l.check_in} → ${l.check_out}` : "Dates not chosen"} · {roomSummary(l)}</span>
                  <span className="flex items-center gap-1"><span className="rounded-full border border-border px-2">{l.status}</span><ChevronDown className={cn("h-4 w-4 md:hidden transition-transform", open && "rotate-180")} /></span>
                </div>
                {l.inbox_stage && <span className="inline-block mt-1 text-xs text-gold">{l.inbox_stage}</span>}
              </Button>
              {open && <div className="md:hidden p-2 bg-muted/30"><LeadWorkspace lead={l} onLost={() => qc.invalidateQueries({ queryKey: ["leads"] })} /></div>}
              </div>
            );})}
          </div>
          <div className="hidden md:block">{sel ? <LeadWorkspace key={sel.id} lead={sel} onLost={() => qc.invalidateQueries({ queryKey: ["leads"] })} /> :
            <div className="luxe-card rounded-xl p-6 text-sm text-muted-foreground">Select an enquiry.</div>}</div>
        </div>
      </div>
    </div>
  );
}

function LeadWorkspace({ lead, onLost }: { lead: Lead; onLost: () => void }) {
  const qc = useQueryClient();
  const [offerInput, setOfferInput] = useState("");
  const offer = directOfferAmount(offerInput);
  const tpls = templates(lead, offer);
  const [text, setText] = useState(tpls[0]?.text ?? "");
  const [note, setNote] = useState("");
  const history = useQuery({ queryKey: ["lead-activities", lead.id], queryFn: () => listLeadActivities({ data: { lead_id: lead.id } }) });
  const activity = useMutation({
    mutationFn: (data: { kind: "stage" | "note" | "offer"; value: string }) => addInboxActivity({ data: { lead_id: lead.id, ...data } }),
    onSuccess: (_, data) => {
      if (data.kind === "note") setNote("");
      toast.success(data.kind === "note" ? "Note saved" : data.kind === "offer" ? "Offer saved" : "Stage saved");
      void qc.invalidateQueries({ queryKey: ["lead-activities", lead.id] }); onLost();
    }, onError: (e) => toast.error(e.message),
  });
  const portal = useMutation({
    mutationFn: async () => {
      if (!lead.booking_id) throw new Error("Create the booking first");
      const b = await getBooking(lead.booking_id);
      if (!b) throw new Error("Booking unavailable");
      await issueBookingToken({ data: { booking_id: b.id } });
      return paymentLinkMessage(b, `https://guest.hotelexcella.in/portal/${b.booking_reference}`);
    }, onSuccess: (message) => { setText(message); toast.success("Payment message ready"); },
    onError: (e) => toast.error(e.message),
  });
  const dups = useQuery({
    queryKey: ["lead-dups", lead.id, lead.check_in, lead.check_out],
    enabled: !!lead.check_in && !!lead.check_out,
    queryFn: () => {
      if (!lead.check_in || !lead.check_out) return [];
      return checkBookingDuplicates({ phone: lead.phone, customerId: lead.customer_id, checkIn: lead.check_in, checkOut: lead.check_out });
    },
  });
  const lost = useMutation({
    mutationFn: (reason: string) => markLeadLost({ data: { id: lead.id, reason } }),
    onSuccess: () => { toast.success("Enquiry archived"); onLost(); },
    onError: (e: any) => toast.error(e.message),
  });
  const matches = (dups.data ?? []).filter((m) => m.id !== lead.booking_id);

  return (
    <div className="p-3 md:p-5 space-y-4 min-w-0">
      <div>
        <h2 className="font-display text-xl">{lead.guest_name}</h2>
        <p className="text-sm text-muted-foreground">{lead.phone}{lead.email ? ` · ${lead.email}` : ""}</p>
        <p className="text-sm mt-1">{lead.check_in ? `${lead.check_in} → ${lead.check_out}` : "Dates not chosen"} · {lead.adults ?? 1} adults{lead.children ? `, ${lead.children} children` : ""} · {roomSummary(lead)}{lead.estimated_total ? ` · ₹${Number(lead.estimated_total).toLocaleString("en-IN")}` : ""}</p>
        {lead.notes && <p className="text-sm text-muted-foreground mt-1">{lead.notes}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Select value={lead.inbox_stage || "clear"} disabled={activity.isPending} onValueChange={(value) => activity.mutate({ kind: "stage", value: value === "clear" ? "" : value })}>
          <SelectTrigger className="w-auto min-w-36" aria-label="Enquiry stage"><SelectValue placeholder="Stage" /></SelectTrigger>
          <SelectContent>{LEAD_STAGES.map((stage) => <SelectItem key={stage} value={stage}>{stage}</SelectItem>)}<SelectItem value="clear">Clear Tag</SelectItem></SelectContent>
        </Select>
      </div>
      {matches.length > 0 && (
        <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm space-y-1">
          <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Active Guest Stay</div>
          {matches.map((m) => (
            <div key={m.id} className="flex justify-between gap-2">
              <span>{m.booking_reference ?? "Booking"} · {m.check_in} → {m.check_out} · {m.status}</span>
              <Link to="/bookings/$id" params={{ id: m.id }} className="underline">View</Link>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {lead.booking_id ? <Button variant="outline" size="sm" disabled={portal.isPending} onClick={() => portal.mutate()}><Link2 className="h-4 w-4 mr-1" />Share Payment Link</Button> :
          <Button asChild variant="outline" size="sm"><Link to="/bookings/new" search={{ fromLeadId: lead.id }}><Plus className="h-4 w-4 mr-1" />Convert to Booking</Link></Button>}
        {tpls.map((t) => <Button key={t.key} size="sm" variant="outline" onClick={() => setText(t.text)}>{t.label}</Button>)}
      </div>
      <div>
        <label htmlFor={`offer-${lead.id}`} className="text-sm font-medium">Direct Offer Price · incl. taxes</label>
        <div className="flex gap-2 mt-1">
          <Input id={`offer-${lead.id}`} type="number" min="0.01" step="0.01" value={offerInput} onChange={(e) => { setOfferInput(e.target.value); setText(templates(lead, directOfferAmount(e.target.value))[0]?.text ?? ""); }} />
          <Button variant="outline" size="icon" title="Save direct offer" aria-label="Save direct offer" disabled={!offer || activity.isPending} onClick={() => { if (offer) activity.mutate({ kind: "offer", value: String(offer) }); }}><Save className="h-4 w-4" /></Button>
        </div>
      </div>
      <Textarea aria-label="WhatsApp message" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="icon" title="Copy message" aria-label="Copy message" onClick={async () => { try { await navigator.clipboard.writeText(text); toast.success("Message copied"); } catch { toast.error("Could not copy message"); } }}><Copy className="h-4 w-4" /></Button>
        <Button asChild><a href={waLink(lead.phone, text)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4 mr-1" />Reply with Template</a></Button>
        <Button asChild variant="outline"><a href={`https://web.whatsapp.com/send?phone=${lead.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"><MessageSquareText className="h-4 w-4 mr-1" />Open Live Chat</a></Button>
        {lead.booking_id && (
          <Button asChild variant="outline"><Link to="/bookings/$id" params={{ id: lead.booking_id }}>View Booking</Link></Button>
        )}
        {LIVE.includes(lead.status) && (
          <Button variant="ghost" disabled={lost.isPending} onClick={() => { const r = window.prompt("Reason for archiving?", "No response"); if (r) lost.mutate(r); }}>
            <Archive className="h-4 w-4 mr-1" />Mark Lost
          </Button>
        )}
      </div>
      <div className="border-t border-border pt-4 space-y-2">
        <h3 className="text-sm font-medium">Internal Staff Notes</h3>
        <Textarea aria-label="Internal staff note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" variant="outline" disabled={!note.trim() || activity.isPending} onClick={() => activity.mutate({ kind: "note", value: note })}><Save className="h-4 w-4 mr-1" />Save Note</Button>
        {history.isError && <p className="text-sm text-destructive">Could not load enquiry history.</p>}
        <div className="max-h-64 overflow-auto divide-y divide-border">
          {(history.data ?? []).map((entry) => <div key={entry.id} className="py-2 text-sm"><p className="whitespace-pre-wrap break-words">{entry.summary}</p><p className="text-xs text-muted-foreground">{entry.actor_name || "System"} · {new Date(entry.created_at).toLocaleString("en-IN")}</p></div>)}
        </div>
      </div>
    </div>
  );
}
