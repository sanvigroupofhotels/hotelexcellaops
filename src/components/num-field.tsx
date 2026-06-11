import { useEffect, useState } from "react";

/**
 * Numeric input shared across forms.
 * Uses local string state so a user can clear the field while typing
 * (e.g. 1000 → 100 → 10 → 1 → empty) without snapping to 0 mid-edit.
 * On blur, empty / below-min is normalized back to `min`.
 *
 * Pass `decimal` to allow fractional values (e.g. unit price, payment amount).
 */
export function NumField({
  label,
  hint,
  value,
  min = 0,
  onChange,
  prefix,
  decimal = false,
  step,
}: {
  label?: string;
  hint?: string;
  value: number;
  min?: number;
  onChange: (v: number) => void;
  prefix?: string;
  decimal?: boolean;
  step?: number;
}) {
  const [raw, setRaw] = useState<string>(String(value));
  useEffect(() => {
    setRaw((cur) => (cur === "" || Number(cur) === value ? cur : String(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const sanitize = (s: string) =>
    decimal
      ? s.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1") // keep first dot only
      : s.replace(/[^0-9]/g, "");

  return (
    <label className="block">
      {label && (
        <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
          {label}
        </span>
      )}
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          type="text"
          inputMode={decimal ? "decimal" : "numeric"}
          pattern={decimal ? "[0-9]*[.]?[0-9]*" : "[0-9]*"}
          value={raw}
          step={step}
          onChange={(e) => {
            const v = sanitize(e.target.value);
            setRaw(v);
            if (v === "" || v === ".") return;
            const n = decimal ? parseFloat(v) : parseInt(v, 10);
            if (Number.isFinite(n) && n >= min) onChange(n);
          }}
          onBlur={() => {
            if (raw === "" || raw === "." || Number(raw) < min || !Number.isFinite(Number(raw))) {
              setRaw(String(min));
              onChange(min);
            }
          }}
          className={`w-full bg-input/60 border border-border rounded-md ${
            prefix ? "pl-7 pr-3" : "px-3"
          } py-3 text-base sm:text-sm font-medium tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition`}
        />
      </div>
      {hint && <span className="block text-[10px] text-muted-foreground/70 mt-1">{hint}</span>}
    </label>
  );
}
