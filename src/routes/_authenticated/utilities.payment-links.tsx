import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, MessageCircle, Plus, Ban, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Topbar } from "@/components/topbar";
import { PaymentLinkDialog } from "@/components/payment-link-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cancelPaymentLink, linkPaymentLinkToBooking, listPaymentLinks, searchLinkableBookings, type PaymentLinkRow } from "@/lib/payment-links.functions";
import { waLink } from "@/lib/whatsapp-pitch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/utilities/payment-links")({
  head: () => ({ meta: [
    { title: "Payment Links — Hotel Excella" },
    { name: "description", content: "Create, track and attach Razorpay payment links to bookings." },
    { property: "og:title", content: "Payment Links — Hotel Excella" },
    { property: "og:description", content: "Create, track and attach Razorpay payment links to bookings." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: PaymentLinksPage,
});

const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;
const msg = (l: PaymentLinkRow) => `Hello ${l.guest_name.split(" ")[0]}, please pay ${inr(l.amount)} towards ${l.purpose} at Hotel Excella using this secure link: ${l.short_url}`;
const badge: Record<string, string> = {
  Paid: "border-success/40 bg-success/10 text-success",
  Issued: "border-gold/40 bg-gold-soft text-gold",
  Expired: "border-border bg-muted text-muted-foreground",
  Cancelled: "border-border bg-muted text-muted-foreground",
};
const FILTERS = ["All", "Issued", "Paid", "Expired", "Cancelled"] as const;

function PaymentLinksPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data = [], isLoading } = useQuery({ queryKey: ["payment-links-console"], queryFn: () => listPaymentLinks() });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [linking, setLinking] = useState<PaymentLinkRow | null>(null);

  const stats = useMemo(() => ({
    collected: data.filter((l) => l.status === "Paid").reduce((s, l) => s + Number(l.amount), 0),
    open: data.filter((l) => l.status === "Issued").length,
    paid: data.filter((l) => l.status === "Paid").length,
    closed: data.filter((l) => l.status === "Expired" || l.status === "Cancelled").length,
  }), [data]);
  const rows = data.filter((l) => (filter === "All" || l.status === filter)
    && (!q || `${l.guest_name} ${l.phone} ${l.purpose}`.toLowerCase().includes(q.toLowerCase())));

  const cancel = useMutation({
    mutationFn: (id: string) => cancelPaymentLink({ data: { id } }),
    onSuccess: () => { toast.success("Link cancelled"); qc.invalidateQueries({ queryKey: ["payment-links-console"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const copy = async (l: PaymentLinkRow) => { try { await navigator.clipboard.writeText(l.short_url); toast.success("Link copied"); } catch { toast.error("Could not copy"); } };

  return (
    <div>
      <Topbar title="Payment Links" subtitle="Standalone Razorpay links for advances and dues"
        action={<PaymentLinkDialog trigger={<Button size="sm" className="hidden md:inline-flex"><Plus className="h-4 w-4" />Create Payment Link</Button>} />} />
      <div className="space-y-4 p-4 md:p-6">
        <div className="md:hidden">
          <h1 className="font-display text-xl">Payment Links</h1>
          <p className="text-xs text-muted-foreground">Create and track guest payments</p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[["Total Collected", inr(stats.collected)], ["Open Links", stats.open], ["Paid Links", stats.paid], ["Expired / Cancelled", stats.closed]].map(([k, v]) => (
            <div key={k as string} className="luxe-card rounded-lg p-4"><div className="text-xs text-muted-foreground">{k}</div><div className="mt-1 font-display text-2xl">{v}</div></div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="max-w-xs" placeholder="Search guest, mobile or purpose" value={q} onChange={(e) => setQ(e.target.value)} />
          {FILTERS.map((f) => <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>{f === "Issued" ? "Open" : f}</Button>)}
        </div>
        <div className="luxe-card divide-y divide-border rounded-lg">
          {isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : !rows.length ? <p className="p-4 text-sm text-muted-foreground">No payment links found.</p> : rows.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{l.guest_name} · {inr(l.amount)}</div>
                <div className="truncate text-xs text-muted-foreground">{l.phone} · {l.purpose} · {new Date(l.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div>
              </div>
              <span className={cn("rounded-full border px-2 py-0.5 text-xs", badge[l.status])}>{l.status === "Issued" ? "Open" : l.status}</span>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" aria-label="Copy link" onClick={() => copy(l)}><Copy className="h-4 w-4" /></Button>
                {l.status === "Issued" && <>
                  <Button size="icon" variant="ghost" aria-label="Share on WhatsApp" onClick={() => window.open(waLink(l.phone, msg(l)), "_blank")}><MessageCircle className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label="Cancel link" disabled={cancel.isPending} onClick={() => { if (confirm("Cancel this payment link?")) cancel.mutate(l.id); }}><Ban className="h-4 w-4" /></Button>
                </>}
                {l.status === "Paid" && (l.booking_id
                  ? <Button size="sm" variant="outline" onClick={() => navigate({ to: "/bookings/$id", params: { id: l.booking_id! } })}>Open Booking</Button>
                  : <Button size="sm" variant="outline" onClick={() => setLinking(l)}><Link2 className="h-4 w-4" />Link</Button>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <PaymentLinkDialog
        trigger={
          <Button
            size="icon"
            aria-label="Create payment link"
            title="Create payment link"
            className="fixed z-30 h-14 w-14 md:hidden rounded-full gold-gradient text-charcoal shadow-lg flex items-center justify-center hover:scale-105 hover:shadow-[0_0_24px_oklch(0.82_0.13_82/0.45)] transition-all duration-200"
            style={{
              right: "max(0.75rem, env(safe-area-inset-right))",
              bottom: "max(0.875rem, calc(env(safe-area-inset-bottom) + 0.5rem))",
            }}
          >
            <Plus className="h-6 w-6" />
          </Button>
        }
      />
      {linking && <LinkDialog link={linking} onClose={() => setLinking(null)} />}
    </div>
  );
}

function LinkDialog({ link, onClose }: { link: PaymentLinkRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState(link.phone);
  const { data = [], isFetching } = useQuery({ queryKey: ["linkable-bookings", q], queryFn: () => searchLinkableBookings({ data: { q } }) });
  const attach = useMutation({
    mutationFn: (booking_id: string) => linkPaymentLinkToBooking({ data: { id: link.id, booking_id } }),
    onSuccess: (r) => { toast.success(`${inr(link.amount)} recorded on ${r.booking_reference}`); qc.invalidateQueries({ queryKey: ["payment-links-console"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="font-display">Link {inr(link.amount)} to a booking</DialogTitle></DialogHeader>
        <Input placeholder="Booking ref, guest name or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {isFetching && !data.length ? <li className="text-xs text-muted-foreground">Searching…</li> : !data.length ? <li className="text-xs text-muted-foreground">No matching bookings.</li> : data.map((b: any) => (
            <li key={b.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
              <div className="min-w-0 flex-1"><div className="font-medium">{b.booking_reference} · {b.guest_name}</div><div className="text-muted-foreground">{b.check_in} → {b.check_out} · {b.status}</div></div>
              <Button size="sm" disabled={attach.isPending} onClick={() => attach.mutate(b.id)}>Attach</Button>
            </li>))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
