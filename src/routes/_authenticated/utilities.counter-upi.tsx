import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Printer, QrCode, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Topbar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/utilities/counter-upi")({ component: CounterUpiPage });

const presets = [500, 1000, 2000, 5000] as const;
const formatINR = (amount: number) => "₹" + amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function CounterUpiPage() {
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [vpa, setVpa] = useState("sanvigroupofhotels@okhdfcbank");
  const [payee, setPayee] = useState("Hotel Excella");
  const qrHost = useRef<HTMLDivElement>(null);
  const validVpa = vpa.trim().includes("@");
  const upiUrl = useMemo(() => {
    const params = new URLSearchParams({ pa: vpa.trim(), pn: payee.trim(), cu: "INR" });
    if (amount > 0) params.set("am", amount.toFixed(2));
    if (note.trim()) params.set("tn", note.trim());
    return "upi://pay?" + params.toString();
  }, [amount, note, payee, vpa]);

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(upiUrl); toast.success("UPI link copied"); }
    catch { toast.error("Could not copy the UPI link"); }
  };
  const printStandee = () => {
    const svgMarkup = qrHost.current?.querySelector("svg")?.outerHTML;
    if (!svgMarkup) return;
    const popup = window.open("", "_blank", "width=700,height=850");
    if (!popup) { toast.error("Allow pop-ups to open the print view"); return; }
    popup.opener = null;
    const title = escapeHtml(payee.trim() || "Hotel Excella");
    const amountText = amount > 0 ? formatINR(amount) : "Enter amount in your UPI app";
    const noteText = escapeHtml(note.trim());
    popup.document.open();
    popup.document.write("<!doctype html><html><head><title>UPI payment · " + title + "</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{font-family:Arial,sans-serif;background:#f5f3ee;color:#1c1b18;margin:0;display:grid;place-items:center;min-height:100vh}.card{text-align:center;background:#fff;border:2px solid #b18b45;border-radius:18px;padding:28px;max-width:440px;width:calc(100% - 64px)}h1{font-size:28px;margin:0 0 8px}p{color:#57534c;margin:8px 0}.amount{font-size:30px;font-weight:700;margin:18px 0}.qr{width:min(78vw,340px);height:auto}.rule{height:1px;background:#dfd3ba;margin:18px 0}@media print{body{background:#fff}.card{box-shadow:none}}</style></head><body><main class=\"card\"><h1>" + title + "</h1><p>Scan to pay securely</p><div class=\"amount\">" + escapeHtml(amountText) + "</div><div class=\"qr\">" + svgMarkup + "</div><div class=\"rule\"></div><p>Scan with GPay, PhonePe, Paytm or BHIM</p><p>Payee: " + title + "</p>" + (noteText ? "<p>Note: " + noteText + "</p>" : "") + "</main><script>window.onload=function(){window.print()}</script></body></html>");
    popup.document.close();
  };

  return (
    <div>
      <Topbar title="Counter UPI QR" subtitle="Create a local QR code for guest payments" />
      <main className="mx-auto grid max-w-5xl gap-4 p-4 md:grid-cols-[0.9fr_1.1fr] md:p-6">
        <section className="luxe-card space-y-5 rounded-xl p-4 md:p-6">
          <div className="flex items-center gap-2 font-display text-lg"><QrCode className="h-5 w-5 text-gold" /> Payment details</div>
          <label className="block space-y-1.5 text-sm"><span>Amount (₹)</span><Input type="number" min="0" step="1" inputMode="decimal" value={amount || ""} onChange={(event) => setAmount(Math.max(0, Number(event.target.value) || 0))} placeholder="Leave blank for guest-entered amount" /></label>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => <Button key={preset} type="button" size="sm" variant="outline" onClick={() => setAmount((current) => current + preset)}>+₹{preset.toLocaleString("en-IN")}</Button>)}
            <Button type="button" size="sm" variant="ghost" onClick={() => setAmount(0)}><RotateCcw className="mr-1 h-3.5 w-3.5" />Clear</Button>
          </div>
          <label className="block space-y-1.5 text-sm"><span>Note / reference</span><Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={80} placeholder="Room 204, Advance, Food Bill" /></label>
          <label className="block space-y-1.5 text-sm"><span>UPI ID (VPA)</span><Input value={vpa} onChange={(event) => setVpa(event.target.value)} autoCapitalize="none" autoCorrect="off" /></label>
          <label className="block space-y-1.5 text-sm"><span>Payee name</span><Input value={payee} onChange={(event) => setPayee(event.target.value)} maxLength={50} /></label>
          <Button variant="outline" className="w-full" onClick={copyLink}><Copy className="mr-2 h-4 w-4" />Copy UPI link</Button>
          <p className="text-[11px] leading-relaxed text-muted-foreground">The QR is generated in this browser. Verify the payee and UPI ID before displaying it to a guest.</p>
        </section>
        <section className="flex flex-col items-center justify-center rounded-2xl border-2 border-gold/60 bg-card p-5 text-center shadow-[0_12px_50px_oklch(0.82_0.13_82/0.08)] md:p-8">
          <div className="font-display text-xl tracking-wide">{payee.trim() || "Hotel Excella"}</div>
          <p className="mt-1 text-xs text-muted-foreground">Scan with GPay, PhonePe, Paytm or BHIM</p>
          <div ref={qrHost} className="my-5 flex min-h-72 w-full max-w-80 items-center justify-center rounded-xl bg-white p-3">
            {validVpa ? <QRCodeSVG value={upiUrl} size={320} level="M" includeMargin title="UPI payment QR code" /> : <div className="px-5 text-sm text-muted-foreground">Enter a valid UPI ID to create the QR code.</div>}
          </div>
          <div className="font-display text-3xl font-semibold text-gold">{amount > 0 ? formatINR(amount) : "Any amount"}</div>
          {note.trim() && <div className="mt-1 max-w-full truncate text-xs text-muted-foreground">Ref: {note}</div>}
          <Button className="mt-5 w-full max-w-xs" onClick={printStandee} disabled={!validVpa}><Printer className="mr-2 h-4 w-4" />Print / fullscreen display</Button>
        </section>
      </main>
    </div>
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] ?? char);
}
