/**
 * Shared reporting date-range engine.
 *
 * Every operational report (HK, Laundry, and future Maintenance / Billing)
 * uses the same set of presets so filter behaviour is identical across the
 * app. Ranges are expressed as inclusive `[from, to]` YYYY-MM-DD strings and
 * compared against the `business_date` column on operational tables.
 *
 * The "Business Date" preset resolves to the current HEOS Business Date from
 * `app_settings.business_date` (via `getBusinessDate`) — never the system
 * date. All other presets are calendar-date driven (Asia/Kolkata local).
 */
import { getBusinessDate } from "@/lib/night-audit-api";
import { toLocalYMD } from "@/lib/utils";

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "business_date"
  | "this_week"
  | "this_month"
  | "custom";

export interface DateRange {
  from: string; // inclusive YYYY-MM-DD
  to: string;   // inclusive YYYY-MM-DD
  label: string;
}

/** Monday-based week (ISO). */
function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // Mon=0 .. Sun=6
  x.setDate(x.getDate() - dow);
  return x;
}

export async function resolvePresetRange(
  preset: DateRangePreset,
  custom?: { from: string; to: string },
): Promise<DateRange> {
  const now = new Date();
  const today = toLocalYMD(now);
  switch (preset) {
    case "today":
      return { from: today, to: today, label: "Today" };
    case "yesterday": {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      const yy = toLocalYMD(y);
      return { from: yy, to: yy, label: "Yesterday" };
    }
    case "business_date": {
      const bd = await getBusinessDate();
      return { from: bd, to: bd, label: `Business Date · ${bd}` };
    }
    case "this_week": {
      const start = startOfWeekMonday(now);
      return { from: toLocalYMD(start), to: today, label: "This Week" };
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toLocalYMD(start), to: today, label: "This Month" };
    }
    case "custom":
    default:
      return {
        from: custom?.from ?? today,
        to: custom?.to ?? today,
        label: "Custom",
      };
  }
}

export const PRESET_OPTIONS: { key: DateRangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "business_date", label: "Business Date" },
  { key: "this_week", label: "This Week" },
  { key: "this_month", label: "This Month" },
  { key: "custom", label: "Custom" },
];

/** Format seconds → "1h 24m" / "42m" / "58s" / "—". */
export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.round(seconds)}s`;
}
