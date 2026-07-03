import { Minus, Plus } from "lucide-react";

/**
 * Shared room-count stepper (+/-) used by every booking entry point:
 * Detailed Booking, Quick Booking, Booking Edit, and any future
 * booking surface. All inventory clamping is driven by the shared
 * `room-inventory.ts` helper — this component only enforces the
 * caller-supplied `max` so overbooking is impossible regardless of
 * input method (buttons, programmatic, etc.).
 */
export function RoomStepper({
  value,
  min = 0,
  max,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  const atMax = max != null && value >= max;
  const atMin = value <= min;
  const clamp = (n: number) => {
    let out = n;
    if (typeof max === "number" && out > max) out = max;
    if (out < min) out = min;
    return out;
  };
  return (
    <div className="flex items-center bg-input/60 border border-border rounded-md overflow-hidden">
      <button
        type="button"
        disabled={atMin}
        onClick={() => onChange(clamp(value - 1))}
        className="p-2.5 hover:bg-secondary transition text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <div className="flex-1 text-center text-sm font-medium tabular-nums">{value}</div>
      <button
        type="button"
        disabled={atMax}
        onClick={() => onChange(clamp(value + 1))}
        className="p-2.5 hover:bg-secondary transition text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
