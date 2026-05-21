// Shared static catalogs and types. No mock data — all live data is in Supabase.

export type QuoteStatus =
  | "Pending"
  | "Sent"
  | "Negotiating"
  | "Converted"
  | "No Response"
  | "Failed";

export const QUOTE_STATUSES: QuoteStatus[] = [
  "Pending",
  "Sent",
  "Negotiating",
  "Converted",
  "No Response",
  "Failed",
];

export const statusStyles: Record<QuoteStatus, string> = {
  Pending: "bg-warning/10 text-warning border-warning/30",
  Sent: "bg-info/10 text-info border-info/30",
  Negotiating: "bg-gold/10 text-gold border-gold/30",
  Converted: "bg-success/10 text-success border-success/30",
  "No Response": "bg-muted-foreground/10 text-muted-foreground border-border",
  Failed: "bg-destructive/10 text-destructive border-destructive/40",
};

export const roomTypes = [
  { name: "Queen Executive (Oak)", rate: 4500 },
  { name: "King Suite (Maple)", rate: 6500 },
  { name: "Deluxe Twin", rate: 3800 },
  { name: "Garden View", rate: 4200 },
  { name: "Presidential", rate: 12000 },
];

// ---------- Hotel Excella charge policies ----------

export const EXTRA_ADULT_RATE = 650; // per night, includes mattress + breakfast
export const DRIVER_RATE = 650; // per night, includes mattress + breakfast
export const EXTRA_BREAKFAST_RATE = 125; // per head, per night

export type EarlyCheckInSlot = "10-13" | "8-10" | "6-8" | "before-6";
export type LateCheckOutSlot = "upto-2pm" | "2-4pm" | "after-4pm";

export const EARLY_CHECK_IN_SLOTS: {
  value: EarlyCheckInSlot;
  label: string;
  /** Flat fee. `null` means "full day room charge". */
  fee: number | null;
}[] = [
  { value: "10-13", label: "10:00 AM – 1:00 PM", fee: 500 },
  { value: "8-10", label: "8:00 AM – 10:00 AM", fee: 750 },
  { value: "6-8", label: "6:00 AM – 8:00 AM", fee: 1000 },
  { value: "before-6", label: "Before 6:00 AM (full day)", fee: null },
];

export const LATE_CHECK_OUT_SLOTS: {
  value: LateCheckOutSlot;
  label: string;
  fee: number | null;
}[] = [
  { value: "upto-2pm", label: "Up to 2:00 PM (3 hrs)", fee: 500 },
  { value: "2-4pm", label: "2:00 PM – 4:00 PM", fee: 1000 },
  { value: "after-4pm", label: "After 4:00 PM (full day)", fee: null },
];

export function earlyCheckInLabel(slot: EarlyCheckInSlot | null | undefined) {
  return EARLY_CHECK_IN_SLOTS.find((s) => s.value === slot)?.label ?? "";
}
export function lateCheckOutLabel(slot: LateCheckOutSlot | null | undefined) {
  return LATE_CHECK_OUT_SLOTS.find((s) => s.value === slot)?.label ?? "";
}
