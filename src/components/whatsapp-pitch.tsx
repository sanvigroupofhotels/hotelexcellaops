import { useEffect, useState } from "react";
import { MessageCircle, Copy, Send } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentStaff } from "@/hooks/use-current-staff";
import { buildPitch, waLink } from "@/lib/whatsapp-pitch";

const EVT = "heos:open-pitch";
export function openWhatsAppPitch() {
  window.dispatchEvent(new CustomEvent(EVT));
}

/** Mounted once (in the signed-in layout). Opens from anywhere via openWhatsAppPitch(). */
export function WhatsAppPitchDialog() {
  const staff = useCurrentStaff();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(EVT, h);
    return () => window.removeEventListener(EVT, h);
  }, []);
  useEffect(() => {
    if (open) setText(buildPitch(staff.email));
  }, [open, staff.email]);

  const digits = phone.replace(/\D/g, "");
  const validPhone = digits.length >= 10;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg w-[calc(100vw-1.5rem)] max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Share Welcome Pitch</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            inputMode="tel"
            placeholder="Guest mobile (10 digits)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} className="text-xs" />
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={!validPhone}
              onClick={() => window.open(waLink(phone, text), "_blank")}
            >
              <Send className="h-4 w-4 mr-1" /> Open WhatsApp
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(text);
                toast.success("Copied");
              }}
            >
              <Copy className="h-4 w-4 mr-1" /> Copy
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WhatsAppPitchButton({ className = "" }: { className?: string }) {
  return (
    <button
      onClick={openWhatsAppPitch}
      aria-label="Share welcome pitch on WhatsApp"
      title="Share welcome pitch"
      className={`p-2 rounded-md text-muted-foreground hover:text-primary ${className}`}
    >
      <MessageCircle className="h-5 w-5" />
    </button>
  );
}
