import { describe, it, expect, vi } from "vitest";
import {
  buildInvoiceDocument, buildRoomLines, buildChargeLines,
} from "@/lib/invoice-document";
import {
  renderInvoicePdf, invoicePdfPageCount, invoiceFileName,
  downloadInvoicePdf, summarisePaymentsByMode, foldChargeTail,
} from "@/lib/invoice-pdf";

const item = (over: Partial<any> = {}): any => ({
  id: over.id ?? crypto.randomUUID(),
  booking_id: "bk",
  position: 0,
  room_type: "Maple Room",
  rooms: 1,
  adults: 2,
  children: 0,
  check_in: "2026-08-10",
  check_out: "2026-08-12",
  nights: 2,
  breakfast_included: false,
  extra_bed: 0,
  rate: 5000,
  subtotal: 10000,
  notes: null,
  early_check_in: false,
  early_check_in_slot: null,
  late_check_out: false,
  late_check_out_slot: null,
  pet_size: "none",
  extra_adults: 0,
  drivers: 0,
  created_at: "2026-08-01",
  updated_at: "2026-08-01",
  ...over,
});

const booking = (over: Partial<any> = {}): any => ({
  id: "bk",
  booking_reference: "HEXB-ABC123",
  guest_name: "Test Guest",
  phone: "+919999999999",
  email: "guest@example.com",
  status: "Confirmed",
  check_in: "2026-08-10",
  check_out: "2026-08-12",
  nights: 2,
  adults: 2,
  children: 0,
  amount: 21000,
  advance_paid: 5000,
  discount: 0,
  tax_rate: 0.05,
  taxes: 1000,
  room_details: "Maple Room",
  ...over,
});

const charge = (over: Partial<any> = {}): any => ({
  id: crypto.randomUUID(),
  user_id: "u",
  booking_id: "bk",
  item_id: null,
  category: "Food",
  other_description: null,
  quantity: 1,
  unit_price: 500,
  amount: 500,
  added_by: null,
  occurred_at: "2026-08-11T10:00:00Z",
  notes: null,
  created_at: "x",
  updated_at: "x",
  ...over,
});

const payment = (n: number, mode = "UPI"): any => ({
  id: crypto.randomUUID(),
  booking_id: "bk",
  amount: n,
  payment_mode: mode,
  occurred_at: "2026-08-10T08:00:00Z",
});

describe("invoice document engine — one engine, two documents", () => {
  it("labels a pre-checkout booking PROFORMA and a checked-out booking INVOICE", () => {
    expect(buildInvoiceDocument({ booking: booking(), items: [item()] }).kind).toBe("PROFORMA INVOICE");
    const final = buildInvoiceDocument({ booking: booking({ status: "Checked-Out" }), items: [item()] });
    expect(final.kind).toBe("INVOICE");
    expect(final.isFinal).toBe(true);
    expect(final.number).toBe("INV-HEXB-ABC123");
  });

  it("proforma and invoice share the same structure (single engine)", () => {
    const it1 = item({ id: "fixed-1" });
    const p = buildInvoiceDocument({ booking: booking(), items: [it1], payments: [payment(5000)], charges: [charge()] });
    const f = buildInvoiceDocument({ booking: booking({ status: "Checked-Out" }), items: [it1], payments: [payment(5000)], charges: [charge()] });
    expect(Object.keys(p).sort()).toEqual(Object.keys(f).sort());
    expect(p.roomLines).toEqual(f.roomLines);
    expect(p.totals.total).toBe(f.totals.total);
  });

  it("totals, taxes, payments and balance match Booking Detail arithmetic", () => {
    const m = buildInvoiceDocument({
      booking: booking(),
      items: [item()],
      payments: [payment(3000), payment(2000, "Cash")],
      charges: [charge({ amount: 500 }), charge({ amount: 1500, unit_price: 1500 })],
    });
    // total = booking.amount + charges
    expect(m.totals.chargesTotal).toBe(2000);
    expect(m.totals.total).toBe(21000 + 2000);
    expect(m.totals.paid).toBe(5000);
    expect(m.totals.balance).toBe(23000 - 5000);
    expect(m.paymentsTotal).toBe(5000);
    expect(m.totals.taxes).toBeGreaterThan(0);
  });

  it("shows Guest Credit when the guest overpaid", () => {
    const m = buildInvoiceDocument({ booking: booking({ advance_paid: 25000 }), items: [item()] });
    expect(m.totals.isCredit).toBe(true);
    expect(Math.abs(m.totals.balance)).toBe(4000);
  });

  it("folds identical rooms into compact lines for multi-room bookings", () => {
    const items = [
      item({ id: "a", room_type: "Maple Room" }),
      item({ id: "b", room_type: "Maple Room" }),
      item({ id: "c", room_type: "Maple Room" }),
      item({ id: "d", room_type: "Oak Room", rate: 6000 }),
    ];
    const lines = buildRoomLines(items);
    expect(lines).toHaveLength(2);
    const maple = lines.find((l) => l.label === "Maple Room")!;
    expect(maple.qty).toBe(3);
    expect(maple.amount).toBe(5000 * 2 * 3);
    expect(maple.itemIds).toEqual(["a", "b", "c"]);
    expect(lines.find((l) => l.label === "Oak Room")!.qty).toBe(1);
  });

  it("keeps booking-item attribution on room-specific charges", () => {
    const items = [item({ id: "i1", room_type: "Maple Room" }), item({ id: "i2", room_type: "Oak Room" })];
    const lines = buildChargeLines(
      [charge({ item_id: "i2", category: "Laundry" }), charge({ item_id: null })],
      items,
      { i2: "205" },
    );
    expect(lines[0]!.room).toBe("Oak Room 205");
    expect(lines[0]!.itemId).toBe("i2");
    expect(lines[1]!.room).toBe("");
  });

  it("excludes removed rooms and never renders an empty document", () => {
    expect(buildRoomLines([item({ item_status: "Removed" })])).toHaveLength(0);
    const m = buildInvoiceDocument({ booking: booking(), items: [] });
    expect(m.roomLines).toHaveLength(1);
  });
});

describe("invoice PDF — single A4 page with signature", () => {
  it("renders a normal booking on exactly one page", () => {
    const m = buildInvoiceDocument({ booking: booking(), items: [item()], payments: [payment(5000)], charges: [charge()] });
    expect(invoicePdfPageCount(m)).toBe(1);
  });

  it("keeps a large multi-room booking with many charges on one page", () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      item({ id: `i${i}`, room_type: i % 2 ? "Maple Room" : "Oak Room", rate: i % 2 ? 5000 : 6000 }));
    const charges = Array.from({ length: 30 }, (_, i) =>
      charge({ item_id: `i${i % 12}`, category: i % 3 ? "Food" : "Laundry", amount: 100 * (i + 1) }));
    const payments = Array.from({ length: 12 }, (_, i) => payment(1000 * (i + 1), i % 2 ? "UPI" : "Cash"));
    const m = buildInvoiceDocument({ booking: booking({ status: "Checked-Out", amount: 250000 }), items, payments, charges });
    expect(invoicePdfPageCount(m)).toBe(1);
  });

  it("keeps the signature block on the same (only) page", () => {
    const m = buildInvoiceDocument({
      booking: booking({ status: "Checked-Out" }),
      items: Array.from({ length: 8 }, (_, i) => item({ id: `s${i}` })),
      charges: Array.from({ length: 25 }, () => charge()),
      branding: { signatory_designation: "General Manager", signature_url: null, invoice_footer: null },
    });
    const doc = renderInvoicePdf(m);
    expect(doc.getNumberOfPages()).toBe(1);
    const text = (doc as any).output("datauristring");
    expect(typeof text).toBe("string");
    expect(m.signature.designation).toBe("General Manager");
  });

  it("proforma also renders through the same single-page engine", () => {
    const m = buildInvoiceDocument({ booking: booking(), items: [item(), item()], charges: [charge()] });
    expect(m.kind).toBe("PROFORMA INVOICE");
    expect(invoicePdfPageCount(m)).toBe(1);
  });

  it("download saves a real PDF file and never calls window.print()", () => {
    const m = buildInvoiceDocument({ booking: booking(), items: [item()] });
    const doc = renderInvoicePdf(m);
    expect(invoiceFileName(m)).toBe("PI-HEXB-ABC123.pdf");
    expect(doc.output("blob").type).toBe("application/pdf");

    // Download must produce a PDF file, never route through the print dialog.
    const printSpy = vi.fn();
    const g = globalThis as any;
    const prevWindow = g.window;
    g.window = { print: printSpy };
    try { downloadInvoicePdf(m); } catch { /* no DOM in the node test env */ }
    expect(printSpy).not.toHaveBeenCalled();
    g.window = prevWindow;
  });

  it("density helpers preserve financial totals while compacting", () => {
    const payments = [payment(1000), payment(2000), payment(500, "Cash")];
    const summarised = summarisePaymentsByMode(payments.map((p) => ({ date: p.occurred_at, mode: p.payment_mode, amount: p.amount })));
    expect(summarised).toHaveLength(2);
    expect(summarised.reduce((s, p) => s + p.amount, 0)).toBe(3500);

    const lines = Array.from({ length: 20 }, (_, i) => ({ label: `C${i}`, room: "", qty: 1, amount: 100, itemId: null }));
    const folded = foldChargeTail(lines, 5);
    expect(folded).toHaveLength(6);
    expect(folded.reduce((s, c) => s + c.amount, 0)).toBe(2000);
    expect(folded[5]!.label).toContain("15 items");
  });
});
