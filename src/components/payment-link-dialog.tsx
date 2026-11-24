import type React from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, IndianRupee, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createPaymentLink, listPaymentLinks, type PaymentLinkRow } from "@/lib/payment-links.functions";
import { waLink } from "@/lib/whatsapp-pitch";

const msg = (l: PaymentLinkRow) => `Hello ${l.guest_name.split(" ")[0]}, please pay ₹${Number(l.amount).toLocaleString("en-IN")} towards ${l.purpose} at Hotel Excella using this secure link: ${l.short_url}`;
const tone: Record<string, string> = { Paid: "text-success", Expired: "text-muted-foreground", Cancelled: "text-muted-foreground", Issued: "text-gold" };

export function PaymentLinkDialog({ trigger }: { trigger?: React.ReactNode } = {}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amount: "", guest_name: "", phone: "", purpose: "Room Advance", expiry: "24h" as "12h" | "24h" | "48h" | "none" });
  const list = useQuery({ queryKey: ["payment-links"], queryFn: () => listPaymentLinks(), enabled: open });
  const create = useMutation({
    mutationFn: () => createPaymentLink({ data: { ...f, amount: Number(f.amount), phone: f.phone.replace(/\D/g, "").slice(-10) } }),
    onSuccess: (l) => { toast.success("Payment link created and SMS sent"); setF({ ...f, amount: "", guest_name: "", phone: "" }); qc.invalidateQueries({ queryKey: ["payment-links"] }); qc.invalidateQueries({ queryKey: ["payment-links-console"] }); window.open(waLink(l.phone, msg(l)), "_blank"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const valid = Number(f.amount) >= 1 && f.guest_name.trim() && f.phone.replace(/\D/g, "").length >= 10 && f.purpose.trim();
  const copy = async (l: PaymentLinkRow) => { try { await navigator.clipboard.writeText(l.short_url); toast.success("Link copied"); } catch { toast.error("Could not copy"); } };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button size="sm" variant="outline"><IndianRupee className="h-4 w-4" />Payment Link</Button>}</DialogTrigger>
      <DialogContent className="top-4 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] translate-y-0 overflow-y-auto overscroll-contain p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:top-[50%] sm:max-h-[90vh] sm:w-full sm:translate-y-[-50%] sm:p-6 sm:max-w-lg">
        <DialogHeader><DialogTitle className="font-display">Create Payment Link</DialogTitle></DialogHeader>
        <div className="grid gap-2">
          <Input className="h-11 sm:h-10" inputMode="decimal" placeholder="Amount (₹)" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <Input className="h-11 sm:h-10" placeholder="Guest name" value={f.guest_name} onChange={(e) => setF({ ...f, guest_name: e.target.value })} />
          <Input className="h-11 sm:h-10" inputMode="tel" placeholder="Mobile (10 digits)" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <Input className="h-11 sm:h-10" placeholder="Purpose" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} />
          <Select value={f.expiry} onValueChange={(v) => setF({ ...f, expiry: v as typeof f.expiry })}>
            <SelectTrigger className="h-11 sm:h-10"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="12h">Expires in 12 hours</SelectItem><SelectItem value="24h">Expires in 24 hours</SelectItem><SelectItem value="48h">Expires in 48 hours</SelectItem><SelectItem value="none">No expiry</SelectItem></SelectContent>
          </Select>
          <Button className="min-h-11" disabled={!valid || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create & Share on WhatsApp"}</Button>
        </div>
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium">Recent Payment Links</h3>
          {list.isLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : !list.data?.length ? <p className="text-xs text-muted-foreground">No links yet.</p> : (
            <ul className="space-y-2">{list.data.map((l) => (
              <li key={l.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{l.guest_name} · ₹{Number(l.amount).toLocaleString("en-IN")}</div>
                  <div className="truncate text-muted-foreground">{l.purpose} · {new Date(l.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div>
                </div>
                <span className={tone[l.status] ?? ""}>{l.status}</span>
                <Button size="icon" variant="ghost" className="h-11 w-11" aria-label="Copy link" onClick={() => copy(l)}><Copy className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label="Share on WhatsApp" onClick={() => window.open(waLink(l.phone, msg(l)), "_blank")}><MessageCircle className="h-4 w-4" /></Button>
              </li>))}</ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
