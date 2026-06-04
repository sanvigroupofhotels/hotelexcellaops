// Shared catalogs, types, and tariff policies for Hotel Excella.
// All live data is in Supabase — nothing in this file is mocked.

// ---------- Quote status (standardized) ----------
export type QuoteStatus =
  | "Draft"
  | "Pending"
  | "Sent"
  | "Negotiation"
  | "Confirmed"
  | "Cancelled"
  | "Completed"
  | "Checked In"
  | "Lost"
  | "Expired"
  // legacy values kept so old rows still render correctly
  | "Negotiating"
  | "Converted"
  | "No Response"
  | "Failed";

export const QUOTE_STATUSES: QuoteStatus[] = [
  "Draft",
  "Pending",
  "Sent",
  "Negotiation",
  "Confirmed",
  "Checked In",
  "Completed",
  "Cancelled",
  "Lost",
  "Expired",
];

/** Statuses that represent a booked / revenue-generating quote. */
export const BOOKED_STATUSES: QuoteStatus[] = ["Confirmed", "Checked In", "Completed", "Converted"];

export const statusStyles: Record<QuoteStatus, string> = {
  Draft: "bg-muted/60 text-muted-foreground border-border",
  Pending: "bg-warning/10 text-warning border-warning/30",
  Sent: "bg-info/10 text-info border-info/30",
  Negotiation: "bg-gold/10 text-gold border-gold/30",
  Confirmed: "bg-success/10 text-success border-success/30",
  "Checked In": "bg-success/15 text-success border-success/40",
  Cancelled: "bg-destructive/10 text-destructive border-destructive/40",
  Completed: "bg-success/15 text-success border-success/40",
  Lost: "bg-destructive/10 text-destructive border-destructive/40",
  Expired: "bg-muted-foreground/10 text-muted-foreground border-border",
  // legacy
  Negotiating: "bg-gold/10 text-gold border-gold/30",
  Converted: "bg-success/10 text-success border-success/30",
  "No Response": "bg-muted-foreground/10 text-muted-foreground border-border",
  Failed: "bg-destructive/10 text-destructive border-destructive/40",
};

// ---------- Room tariffs (correct Excella rates) ----------
export interface RoomTariff {
  name: string;
  bed: string;
  withBreakfast: number;
  withoutBreakfast: number;
}

export const ROOM_TARIFFS: RoomTariff[] = [
  { name: "Oak Room", bed: "Queen Bed", withBreakfast: 2500, withoutBreakfast: 2250 },
  { name: "Mapple Room", bed: "King Bed", withBreakfast: 3000, withoutBreakfast: 2750 },
];

// Backwards-compatible export (room selector uses .name)
export const roomTypes = ROOM_TARIFFS.map((r) => ({
  name: r.name,
  rate: r.withBreakfast,
}));

export function getRoomRate(roomName: string, breakfastIncluded: boolean): number {
  const r = ROOM_TARIFFS.find((x) => x.name === roomName) ?? ROOM_TARIFFS[0];
  return breakfastIncluded ? r.withBreakfast : r.withoutBreakfast;
}

// ---------- Charge policies (corrected) ----------
export const EXTRA_ADULT_RATE = 500; // per night, incl. mattress & breakfast
export const DRIVER_RATE = 500; // per night, incl. mattress & breakfast
export const EXTRA_BREAKFAST_RATE = 150; // per head per night (only when breakfast NOT included)

export const PET_RATES = { none: 0, small: 500, medium: 750, large: 1000 } as const;
export type PetSize = keyof typeof PET_RATES;
export const PET_OPTIONS: { value: PetSize; label: string; fee: number }[] = [
  { value: "none", label: "No Pet", fee: 0 },
  { value: "small", label: "Small Pet", fee: 500 },
  { value: "medium", label: "Medium Pet", fee: 750 },
  { value: "large", label: "Large Pet", fee: 1000 },
];

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

// ---------- CRM enums ----------
export const CUSTOMER_STATUSES = [
  "Hot Lead",
  "Warm Lead",
  "Cold Lead",
  "Active Guest",
  "Repeat Guest",
  "VIP",
  "Lost",
] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const customerStatusStyles: Record<string, string> = {
  "Hot Lead": "bg-destructive/15 text-destructive border-destructive/40",
  "Warm Lead": "bg-warning/15 text-warning border-warning/40",
  "Cold Lead": "bg-info/15 text-info border-info/40",
  "Active Guest": "bg-success/15 text-success border-success/40",
  "Repeat Guest": "bg-gold/15 text-gold border-gold/40",
  VIP: "bg-gold-soft text-gold border-gold/50",
  Lost: "bg-muted-foreground/10 text-muted-foreground border-border",
};

export const DEFAULT_TAGS = [
  "VIP",
  "Couple",
  "Single Guest",
  "Corporate",
  "Travel Agent",
  "Repeat Guest",
  "Long Stay",
  "Family Guest",
  "Business Traveler",
  "Lost",
  "Never Booked",
] as const;

export const LEAD_SOURCES = [
  "Walk-in",
  "Phone Call",
  "WhatsApp",
  "Website",
  "Google Business Profile",
  "Travel Agent",
  "Corporate Referral",
  "Repeat Guest",
  "OTA",
  "Direct",
  "Other",
] as const;

// ---------- Bookings ----------
export type BookingStatus =
  | "Draft"
  | "Confirmed"
  | "Cancelled"
  | "Advance Paid"
  | "Full Paid"
  | "Stay Completed";
export const BOOKING_STATUSES: BookingStatus[] = [
  "Draft",
  "Confirmed",
  "Advance Paid",
  "Full Paid",
  "Stay Completed",
  "Cancelled",
];
export const bookingStatusStyles: Record<BookingStatus, string> = {
  Draft: "bg-muted/60 text-muted-foreground border-border",
  Confirmed: "bg-success/15 text-success border-success/40",
  Cancelled: "bg-destructive/10 text-destructive border-destructive/40",
  "Advance Paid": "bg-info/15 text-info border-info/40",
  "Full Paid": "bg-success/20 text-success border-success/50",
  "Stay Completed": "bg-gold/15 text-gold border-gold/40",
};

export const PAYMENT_STATUSES = [
  "None",
  "Advance Paid",
  "Balance Pending",
  "Fully Paid",
  "Refund Pending",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const paymentStatusStyles: Record<string, string> = {
  None: "bg-muted text-muted-foreground border-border",
  "Advance Paid": "bg-info/15 text-info border-info/40",
  "Balance Pending": "bg-warning/15 text-warning border-warning/40",
  "Fully Paid": "bg-success/15 text-success border-success/40",
  "Refund Pending": "bg-destructive/15 text-destructive border-destructive/40",
};

export const LOST_REASONS = [
  "Too Expensive",
  "No Response",
  "Booked Elsewhere",
  "Date Changed",
  "Not Interested",
] as const;

export const NEXT_ACTIONS = [
  "Call Tomorrow",
  "Send Revised Quote",
  "Awaiting Confirmation",
  "Payment Pending",
  "Send Follow-up",
  "Confirm Advance Payment",
] as const;

export const TASK_TYPES = [
  "Follow-up",
  "Negotiation",
  "Awaiting Response",
  "Payment",
  "Booking Confirmation",
  "Other",
] as const;

export const TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
export const TASK_STATUSES = ["Open", "In Progress", "Done"] as const;

export const taskPriorityStyles: Record<string, string> = {
  Low: "bg-muted text-muted-foreground border-border",
  Medium: "bg-info/15 text-info border-info/40",
  High: "bg-warning/15 text-warning border-warning/40",
  Urgent: "bg-destructive/15 text-destructive border-destructive/40",
};

export const BOOKING_PROBABILITIES = [20, 50, 80] as const;

export const STANDARD_TIMINGS = {
  checkIn: "1:00 PM",
  checkOut: "11:00 AM",
};
