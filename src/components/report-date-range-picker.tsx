import { useState, useEffect } from "react";
import { PRESET_OPTIONS, resolvePresetRange, type DateRange, type DateRangePreset } from "@/lib/reporting/date-range";
import { cn, toLocalYMD } from "@/lib/utils";

/**
 * Shared operational date-range picker used by every reporting screen.
 * Preset chips + optional custom from/to inputs. Fully controlled — the
 * parent stores the resolved `DateRange` and receives updates via
 * `onChange`. Uses the Business Date engine for the "Business Date" chip.
 */
export function ReportDateRangePicker({
  value,
  onChange,
  className,
}: {
  value: DateRange;
  onChange: (r: DateRange, preset: DateRangePreset) => void;
  className?: string;
}) {
  const [preset, setPreset] = useState<DateRangePreset>("today");
  const [customFrom, setCustomFrom] = useState(value.from);
  const [customTo, setCustomTo] = useState(value.to);

  // Keep custom inputs in sync when a preset drives the value externally.
  useEffect(() => {
    if (preset !== "custom") {
      setCustomFrom(value.from);
      setCustomTo(value.to);
    }
  }, [value.from, value.to, preset]);

  const pick = async (p: DateRangePreset) => {
    setPreset(p);
    if (p === "custom") {
      onChange({ from: customFrom, to: customTo, label: "Custom" }, "custom");
      return;
    }
    const r = await resolvePresetRange(p);
    onChange(r, p);
  };

  const applyCustom = () => {
    const from = customFrom || toLocalYMD();
    const to = customTo || from;
    onChange({ from, to, label: "Custom" }, "custom");
  };

  return (
    <div className={cn("luxe-card rounded-xl p-3 flex flex-wrap items-center gap-2", className)}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-muted-foreground uppercase tracking-wider">Range:</span>
        {PRESET_OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => pick(o.key)}
            className={cn(
              "rounded-full border px-3 py-0.5 transition",
              preset === o.key
                ? "border-gold/60 bg-gold-soft/60 text-foreground"
                : "border-border bg-card text-muted-foreground hover:border-gold/40",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex items-center gap-1.5 text-[11px]">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="bg-input/60 border border-border rounded-md px-2 py-1 text-xs"
          />
          <span className="text-muted-foreground">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="bg-input/60 border border-border rounded-md px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={applyCustom}
            className="rounded-md border border-gold/40 bg-gold-soft/40 px-2 py-1 text-xs hover:bg-gold-soft/60"
          >
            Apply
          </button>
        </div>
      )}
      <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
        {value.from === value.to ? value.from : `${value.from} → ${value.to}`}
      </span>
    </div>
  );
}
