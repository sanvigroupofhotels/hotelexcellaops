import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, AlertTriangle, MessageSquareText, Archive } from "lucide-react";
import { toast } from "sonner";
import { Topbar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { listLeads, markLeadLost } from "@/lib/leads.functions";
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

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function templates(l: Lead) {
  const name = l.guest_name?.split(" ")[0] ?? "";
  const stay = l.check_in ? ` for ${l.check_in} to ${l.check_out}` : "";
  return [
    { key: "quote", label: "Rate Quote", text: `Hello ${name}, thank you for your enquiry at Hotel Excella${stay}. ${roomSummary(l)}${l.estimated_total ? `: ₹${Number(l.estimated_total).toLocaleString("en-IN")} incl. taxes` : ""}. ${l.booking_id ? "Your reservation is recorded; please reply to confirm your arrival." : "Reply to confirm and we will hold your room."}` },
    { key: "location", label: "Location", text: `Hello ${name}, Hotel Excella, Visakhapatnam. Directions: https://maps.google.com/?q=Hotel+Excella+Visakhapatnam . Call reception: +91 9985908131.` },
    { key: "portal", label: "Guest Portal", text: `Hello ${name}, complete your check-in details here: https://guest.hotelexcella.in` },
    { key: "custom", label: "Custom", text: `Hello ${name}, ` },
  ];
}

function WhatsAppInbox() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"live" | "history">("live");
  const [selId, setSelId] = useState<string | null>(null);
  const leads = useQuery({ queryKey: ["leads"], queryFn: () => listLeads(), refetchInterval: 15000 });
  const rows = useMemo(() => (leads.data ?? []).filter((l) => (tab === "live") === LIVE.includes(l.status)), [leads.data, tab]);
  const sel = rows.find((l) => l.id === selId) ?? rows[0] ?? null;

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
          <div className="luxe-card rounded-xl divide-y divide-border max-h-[70vh] overflow-auto">
            {leads.isLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
            {!leads.isLoading && rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">No enquiries here.</p>}
            {rows.map((l) => (
              <button key={l.id} onClick={() => setSelId(l.id)} className={cn("w-full text-left p-3 hover:bg-muted/50", sel?.id === l.id && "bg-muted")}>
                <div className="flex justify-between gap-2">
                  <span className="font-medium truncate">{l.guest_name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{ago(l.last_activity_at)}</span>
                </div>
                <div className="text-xs text-muted-foreground">{l.phone} · {l.source_channel}</div>
                <div className="text-xs mt-1 flex justify-between">
                  <span>{l.check_in ? `${l.check_in} → ${l.check_out}` : "Dates not chosen"} · {roomSummary(l)}</span>
                  <span className="rounded-full border border-border px-2">{l.status}</span>
                </div>
              </button>
            ))}
          </div>
          {sel ? <LeadWorkspace key={sel.id} lead={sel} onLost={() => qc.invalidateQueries({ queryKey: ["leads"] })} /> :
            <div className="luxe-card rounded-xl p-6 text-sm text-muted-foreground">Select an enquiry.</div>}
        </div>
      </div>
    </div>
  );
}

function LeadWorkspace({ lead, onLost }: { lead: Lead; onLost: () => void }) {
  const tpls = templates(lead);
  const [text, setText] = useState(tpls[0].text);
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
    <div className="luxe-card rounded-xl p-5 space-y-4">
      <div>
        <h2 className="font-display text-xl">{lead.guest_name}</h2>
        <p className="text-sm text-muted-foreground">{lead.phone}{lead.email ? ` · ${lead.email}` : ""}</p>
        <p className="text-sm mt-1">{lead.check_in ? `${lead.check_in} → ${lead.check_out}` : "Dates not chosen"} · {lead.adults ?? 1} adults{lead.children ? `, ${lead.children} children` : ""} · {roomSummary(lead)}{lead.estimated_total ? ` · ₹${Number(lead.estimated_total).toLocaleString("en-IN")}` : ""}</p>
        {lead.notes && <p className="text-sm text-muted-foreground mt-1">{lead.notes}</p>}
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
        {tpls.map((t) => <Button key={t.key} size="sm" variant="outline" onClick={() => setText(t.text)}>{t.label}</Button>)}
      </div>
      <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap gap-2">
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
    </div>
  );
}
