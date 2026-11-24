import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Copy, Calculator } from "lucide-react";
import { toast } from "sonner";
import { Topbar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/utilities/gst-calculator")({ component: GstCalculatorPage });

type Mode = "forward" | "reverse";
type Supply = "intra" | "inter";
const slabs = [0, 5, 12, 18] as const;
const inr = (amount: number) => "₹" + amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function GstCalculatorPage() {
  const [mode, setMode] = useState<Mode>("forward");
  const [supply, setSupply] = useState<Supply>("intra");
  const [amount, setAmount] = useState("2500");
  const [rate, setRate] = useState(12);
  const [customRate, setCustomRate] = useState("12");
  const isCustom = !slabs.includes(rate as (typeof slabs)[number]);
  const result = useMemo(() => {
    const entered = Math.max(0, Number(amount) || 0);
    const taxRate = Math.max(0, Number(rate) || 0);
    const base = mode === "forward" ? entered : entered / (1 + taxRate / 100);
    const tax = mode === "forward" ? base * taxRate / 100 : entered - base;
    const total = base + tax;
    return { base, tax, total, half: tax / 2, rate: taxRate };
  }, [amount, mode, rate]);

  const chooseRate = (value: number) => {
    setRate(value);
    setCustomRate(String(value));
  };
  const copyBreakdown = async () => {
    const lines = [
      "Hotel Excella - Tariff Breakdown",
      "Base Tariff: " + inr(result.base),
      ...(supply === "intra"
        ? ["CGST (" + (result.rate / 2) + "%): " + inr(result.half), "SGST (" + (result.rate / 2) + "%): " + inr(result.half)]
        : ["IGST (" + result.rate + "%): " + inr(result.tax)]),
      "Total Payable: " + inr(result.total) + " (" + (mode === "reverse" ? "GST inclusive" : "GST added") + ")",
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Breakdown copied");
    } catch {
      toast.error("Could not copy the breakdown");
    }
  };

  return (
    <div>
      <Topbar title="GST Calculator" subtitle="Quick forward and reverse tariff calculations" />
      <main className="mx-auto grid max-w-5xl gap-4 p-4 md:grid-cols-[1fr_1fr] md:p-6">
        <section className="luxe-card space-y-5 rounded-xl p-4 md:p-6">
          <div className="flex items-center gap-2 font-display text-lg"><Calculator className="h-5 w-5 text-gold" /> Calculation inputs</div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant={mode === "forward" ? "default" : "outline"} onClick={() => setMode("forward")}>Add GST</Button>
            <Button variant={mode === "reverse" ? "default" : "outline"} onClick={() => setMode("reverse")}>Remove GST</Button>
          </div>
          <label className="block space-y-1.5 text-sm">
            <span>{mode === "forward" ? "Base tariff (before GST)" : "Total amount (GST included)"}</span>
            <Input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <div className="space-y-2">
            <div className="text-sm">GST rate</div>
            <div className="grid grid-cols-4 gap-2">
              {slabs.map((slab) => <Button key={slab} variant={rate === slab ? "default" : "outline"} onClick={() => chooseRate(slab)}>{slab}%</Button>)}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Custom %
              <Input className="h-9 max-w-28" type="number" min="0" max="100" step="0.01" value={customRate} onChange={(event) => { setCustomRate(event.target.value); setRate(Math.min(100, Math.max(0, Number(event.target.value) || 0))); }} />
            </label>
            {isCustom && <p className="text-[11px] text-muted-foreground">Custom rate: {rate}%</p>}
          </div>
          <div className="space-y-2">
            <div className="text-sm">Place of supply</div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant={supply === "intra" ? "default" : "outline"} onClick={() => setSupply("intra")}>Within Andhra Pradesh</Button>
              <Button variant={supply === "inter" ? "default" : "outline"} onClick={() => setSupply("inter")}>Outside AP</Button>
            </div>
          </div>
        </section>
        <section className="luxe-card flex flex-col rounded-xl border-border/60 p-4 md:p-6">
          <div className="text-xs uppercase tracking-[0.18em] text-gold">Live breakdown</div>
          <div className="mt-4 flex-1 space-y-3 text-sm">
            <Line label="Base amount" value={inr(result.base)} />
            {supply === "intra" ? <>
              <Line label={"CGST (" + result.rate / 2 + "%)"} value={inr(result.half)} />
              <Line label={"SGST (" + result.rate / 2 + "%)"} value={inr(result.half)} />
            </> : <Line label={"IGST (" + result.rate + "%)"} value={inr(result.tax)} />}
            <div className="border-t border-border pt-3"><Line label="Grand total" value={inr(result.total)} strong /></div>
          </div>
          <Button className="mt-5 w-full" onClick={copyBreakdown}><Copy className="mr-2 h-4 w-4" />Copy Breakdown</Button>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">For estimation only. Confirm the applicable GST rate and input-tax-credit treatment with your accounts team before billing.</p>
        </section>
      </main>
    </div>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={cn("flex items-center justify-between gap-3", strong && "font-semibold text-foreground")}><span className={strong ? "text-base" : "text-muted-foreground"}>{label}</span><span className={strong ? "text-lg text-gold" : "tabular-nums"}>{value}</span></div>;
}
