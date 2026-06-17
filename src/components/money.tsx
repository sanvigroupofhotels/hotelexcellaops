import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * <Money/> — operational numeric display.
 * - Sans-serif, semi/bold, tabular-nums, high contrast.
 * - Auto-fits to its container on a single line. Shrinks font-size if needed,
 *   never overflows, never wraps.
 *
 * Use everywhere we render an Indian-currency amount in an operational
 * context (dashboard cards, cashbook, payment reports, house view popups,
 * booking totals, dues, salary, ledger).
 */
export function Money({
  value,
  className,
  prefix = "₹",
  suffix,
  size = "md",
  min = 11,
  /** Maximum font-size in px. Defaults to a reasonable per-size cap. */
  max,
}: {
  value: number | string;
  className?: string;
  prefix?: string;
  suffix?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  min?: number;
  max?: number;
}) {
  const n = typeof value === "number" ? value : Number(value || 0);
  const text = `${prefix}${(isFinite(n) ? n : 0).toLocaleString("en-IN")}${suffix ?? ""}`;
  const initialMax = max ?? ({ sm: 14, md: 18, lg: 26, xl: 32, "2xl": 40 }[size]);
  return (
    <AutoFitText
      text={text}
      className={cn("stat-num", className)}
      min={min}
      max={initialMax}
    />
  );
}

/** Generic single-line auto-fit. Shrinks font-size to fit the parent width. */
export function AutoFitText({
  text,
  className,
  min = 10,
  max = 24,
}: {
  text: string;
  className?: string;
  min?: number;
  max?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(max);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;

    const fit = () => {
      let lo = min;
      let hi = max;
      // binary search highest size that fits parent's content width
      el.style.fontSize = `${hi}px`;
      const target = parent.clientWidth;
      if (el.scrollWidth <= target) { setSize(hi); return; }
      while (lo < hi - 0.5) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${mid}px`;
        if (el.scrollWidth <= target) lo = mid; else hi = mid;
      }
      setSize(Math.floor(lo));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [text, min, max]);

  return (
    <span
      ref={ref}
      className={cn("inline-block whitespace-nowrap leading-none", className)}
      style={{ fontSize: `${size}px` }}
    >
      {text}
    </span>
  );
}

/**
 * <MetricCard/> — consistent operational metric tile.
 * Used by Home dashboard, Cashbook, Payment Reports, House View summary.
 * Decorative serif is reserved for page titles; metric values use the
 * sans-serif tabular operational typography (.stat-num via <Money/>).
 */
export function MetricCard({
  label,
  value,
  icon,
  emoji,
  sublabel,
  onClick,
  className,
  tone = "default",
}: {
  label: string;
  value: number | string;
  icon?: ReactNode;
  emoji?: string;
  sublabel?: ReactNode;
  onClick?: () => void;
  className?: string;
  tone?: "default" | "gold" | "success" | "warning" | "destructive";
}) {
  const toneCls =
    tone === "gold" ? "text-gold"
      : tone === "success" ? "text-[oklch(0.72_0.15_155)]"
        : tone === "warning" ? "text-[oklch(0.78_0.15_75)]"
          : tone === "destructive" ? "text-destructive"
            : "text-foreground";
  const Comp: any = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "luxe-card rounded-xl p-4 text-left w-full transition-all",
        onClick && "hover:border-gold/40 hover:bg-secondary/40",
        className,
      )}
    >
      <div className="flex items-center justify-between min-h-[20px]">
        {emoji ? <span className="text-lg leading-none">{emoji}</span> : <span />}
        {icon && <span className="text-gold">{icon}</span>}
      </div>
      <div className="mt-3 w-full">
        {typeof value === "number" ? (
          <Money value={value} size="xl" className={toneCls} />
        ) : (
          <AutoFitText text={String(value)} className={cn("stat-num", toneCls)} min={12} max={32} />
        )}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1.5 tracking-wide uppercase">{label}</div>
      {sublabel && <div className="text-[11px] text-muted-foreground mt-0.5">{sublabel}</div>}
    </Comp>
  );
}
