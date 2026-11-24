import type React from "react";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, IndianRupee, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createPaymentLink, type PaymentLinkRow } from "@/lib/payment-links.functions";
import { waLink } from "@/lib/whatsapp-pitch";

const msg = (l: PaymentLinkRow) => `Hello ${l.guest_name.split(" ")[0]}, please pay ₹${Number(l.amount).toLocaleString("en-IN")} towards ${l.purpose} at Hotel Excella using this secure link: ${l.short_url}`;
const tone: Record<string, string> = { Paid: "text-success", Expired: "text-muted-foreground", Cancelled: "text-muted-foreground", Issued: "text-gold" };

export function PaymentLinkDialog({ trigger }: { trigger?: React.ReactNode } = {}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState<{ top: number; height: number } | null>(null);
  const [f, setF] = useState({ amount: "", guest_name: "", phone: "", purpose: "Room Advance", expiry: "24h" as "12h" | "24h" | "48h" | "none" });
  const create = useMutation({
    mutationFn: () => createPaymentLink({ data: { ...f, amount: Number(f.amount), phone: f.phone.replace(/\D/g, "").slice(-10) } }),
    onSuccess: (l) => { toast.success("Payment link created and SMS sent"); setF({ ...f, amount: "", guest_name: "", phone: "" }); qc.invalidateQueries({ queryKey: ["payment-links-console"] }); window.open(waLink(l.phone, msg(l)), "_blank"); },
    onError: (e: Error) => toast.error(e.message),
  });
  useEffect(() => {
    if (!open) {
      setMobileViewport(null);
      return;
    }

    const updateViewport = () => {
      if (!window.matchMedia("(max-width: 767px)").matches) {
        setMobileViewport(null);
        return;
      }
      const viewport = window.visualViewport;
      setMobileViewport({
        top: viewport?.offsetTop ?? 0,
        height: viewport?.height ?? window.innerHeight,
      });
    };

    updateViewport();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    return () => {
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, [open]);
  const valid = Number(f.amount) >= 1 && f.guest_name.trim() && f.phone.replace(/\D/g, "").length >= 10 && f.purpose.trim();
  const copy = async (l: PaymentLinkRow) => { try { await navigator.clipboard.writeText(l.short_url); toast.success("Link copied"); } catch { toast.error("Could not copy"); } };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button size="sm" variant="outline"><IndianRupee className="h-4 w-4" />Payment Link</Button>}</DialogTrigger>
      <DialogContent
        className="left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-screen translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 md:left-[50%] md:top-[50%] md:grid md:h-auto md:max-h-[90vh] md:w-full md:translate-x-[-50%] md:translate-y-[-50%] md:gap-4 md:overflow-y-auto md:rounded-lg md:border md:p-6 md:max-w-lg"
        style={mobileViewport ? { top: `${mobileViewport.top}px`, height: `${mobileViewport.height}px`, maxHeight: `${mobileViewport.height}px` } : undefined}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 text-left md:border-0 md:p-0 md:pr-8">
          <DialogTitle className="font-display">Create Payment Link</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:overflow-visible md:px-0 md:py-0">
          <div className="grid gap-3 md:gap-2">
            <Input className="h-11 md:h-9" inputMode="decimal" placeholder="Amount (₹)" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            <Input className="h-11 md:h-9" placeholder="Guest name" value={f.guest_name} onChange={(e) => setF({ ...f, guest_name: e.target.value })} />
            <Input className="h-11 md:h-9" inputMode="tel" placeholder="Mobile (10 digits)" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            <Input className="h-11 md:h-9" placeholder="Purpose" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} />
            <Select value={f.expiry} onValueChange={(v) => setF({ ...f, expiry: v as typeof f.expiry })}>
              <SelectTrigger className="h-11 md:h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="12h">Expires in 12 hours</SelectItem><SelectItem value="24h">Expires in 24 hours</SelectItem><SelectItem value="48h">Expires in 48 hours</SelectItem><SelectItem value="none">No expiry</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        <div className="shrink-0 border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:border-0 md:p-0">
          <Button className="h-11 w-full md:h-10" disabled={!valid || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create & Share on WhatsApp"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
