export type QuoteStatus =
  | "Pending"
  | "Sent"
  | "Negotiating"
  | "Converted"
  | "No Response"
  | "Failed";

export interface Quote {
  id: string;
  guest: string;
  phone: string;
  email: string;
  checkIn: string;
  checkOut: string;
  amount: number;
  status: QuoteStatus;
  updated: string;
  nights: number;
  roomType: string;
}

export const mockQuotes: Quote[] = [
  { id: "HEX-250520-001", guest: "Rohit Sharma", phone: "+91 98765 43210", email: "rohit.sharma@email.com", checkIn: "25 May", checkOut: "27 May", amount: 10640, status: "Sent", updated: "20 May 2025", nights: 2, roomType: "Queen Executive (Oak)" },
  { id: "HEX-250519-003", guest: "Priya Mehta", phone: "+91 99887 12345", email: "priya@email.com", checkIn: "10 Jun", checkOut: "12 Jun", amount: 14250, status: "Negotiating", updated: "19 May 2025", nights: 2, roomType: "King Suite (Maple)" },
  { id: "HEX-250518-007", guest: "Arjun Verma", phone: "+91 98123 88122", email: "arjun.v@email.com", checkIn: "05 Jul", checkOut: "07 Jul", amount: 8500, status: "Pending", updated: "18 May 2025", nights: 2, roomType: "Deluxe Twin" },
  { id: "HEX-250517-002", guest: "Sneha Iyer", phone: "+91 97777 11111", email: "sneha@email.com", checkIn: "02 Jun", checkOut: "04 Jun", amount: 11200, status: "Converted", updated: "17 May 2025", nights: 2, roomType: "Queen Executive (Oak)" },
  { id: "HEX-250516-005", guest: "Karan Patel", phone: "+91 96666 22222", email: "karan@email.com", checkIn: "28 May", checkOut: "30 May", amount: 9800, status: "No Response", updated: "16 May 2025", nights: 2, roomType: "Garden View" },
  { id: "HEX-250515-004", guest: "Neha Gupta", phone: "+91 95555 33333", email: "neha@email.com", checkIn: "15 Jun", checkOut: "17 Jun", amount: 13450, status: "Failed", updated: "15 May 2025", nights: 2, roomType: "King Suite (Maple)" },
  { id: "HEX-250514-009", guest: "Vikram Singh", phone: "+91 94444 55555", email: "vikram@email.com", checkIn: "20 Jul", checkOut: "23 Jul", amount: 18200, status: "Converted", updated: "14 May 2025", nights: 3, roomType: "Presidential" },
  { id: "HEX-250513-011", guest: "Ananya Roy", phone: "+91 93333 77777", email: "ananya@email.com", checkIn: "08 Jun", checkOut: "09 Jun", amount: 5400, status: "Sent", updated: "13 May 2025", nights: 1, roomType: "Deluxe Twin" },
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

export const kpis = {
  totalQuotes: 24,
  pending: 12,
  converted: 6,
  estRevenue: 124500,
  conversionRate: 38,
  avgQuoteValue: 11240,
};
