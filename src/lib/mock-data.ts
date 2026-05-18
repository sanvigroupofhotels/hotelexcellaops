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
