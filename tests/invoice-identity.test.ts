import { describe, expect, it } from "vitest";
import { resolveBranding } from "@/lib/branding";
import { invoiceBillingSchema } from "@/lib/invoice-billing";
import { buildInvoiceDocument, numberToWordsINR, splitInvoiceGst } from "@/lib/invoice-document";

const booking = {
  booking_reference: "HEXB-86102E", guest_name: "Mr. Nageswara Reddy", status: "Checked-Out",
  check_in: "2026-11-12", check_out: "2026-11-14", nights: 2, amount: 4550, taxes: 217,
  tax_rate: 0.05, taxes_included: true, discount: 0, advance_paid: 4550,
} as any;

describe("approved unified invoice rules", () => {
  it("final invoice uses the approved booking-reference number", () => {
    expect(buildInvoiceDocument({ booking }).number).toBe("INV-HEXB-86102E");
  });
  it("identity, contact and signature come from Branding, overriding the legacy source", () => {
    const branding = resolveBranding({ legal_name: "SANVI GROUP OF HOTELS", name: "Hotel Excella", gstin: "37AEQFS5192B1ZO", address: "Vizag", phone: "9985908131", signature_url: "saved-signature", signatory_designation: "Manager" }, { name: "Old Hotel", address: "Goa" });
    const doc = buildInvoiceDocument({ booking, branding });
    expect(doc.hotel.legal_name).toBe("SANVI GROUP OF HOTELS");
    expect(doc.hotel.name).toBe("Hotel Excella");
    expect(doc.hotel.gstin).toBe("37AEQFS5192B1ZO");
    expect(doc.hotel.address).toBe("Vizag");
    expect(doc.hotel.phone).toBe("9985908131");
    expect(doc.signature).toEqual({ url: "saved-signature", designation: "Manager" });
  });
  it("clearing a Branding field does not revive stale legacy identity", () => {
    expect(resolveBranding({ gstin: "" }, { gstin: "37AEQFS5192B1ZO" }).gstin).toBe("");
  });
  it("guest company and GSTIN are taken from the linked customer", () => {
    const doc = buildInvoiceDocument({ booking, billing: { company_name: "LITHOUS SERVICES PRIVATE LIMITED", gst_number: "37AAECL2341L1ZF", company_address: "Vizag" } });
    expect(doc.guest.company).toBe("LITHOUS SERVICES PRIVATE LIMITED");
    expect(doc.guest.gstin).toBe("37AAECL2341L1ZF");
  });
  it("5% accommodation GST is split at 2.5% each without losing odd paise", () => {
    expect(splitInvoiceGst(217, 0.05)).toEqual([{ label: "CGST", rate: 2.5, amount: 108.5 }, { label: "SGST", rate: 2.5, amount: 108.5 }]);
    expect(splitInvoiceGst(217.01, 0.05).reduce((s, t) => s + t.amount, 0)).toBe(217.01);
  });
  it("a guest's interstate GSTIN does not change accommodation's hotel place of supply", () => {
    const doc = buildInvoiceDocument({ booking, billing: { company_name: "Guest company", gst_number: "29AAECL2341L1ZF", company_address: "Bengaluru" } });
    expect(doc.taxLines.map((t) => t.label)).toEqual(["CGST", "SGST"]);
  });
  it("amount in words includes correct rupees and paise, not a rounded amount", () => {
    expect(numberToWordsINR(4500.60)).toBe("Indian Rupee Four Thousand Five Hundred and Sixty Paise Only");
    expect(numberToWordsINR(4550)).toBe("Indian Rupee Four Thousand Five Hundred and Fifty Only");
    expect(numberToWordsINR(100000)).toBe("Indian Rupee One Lakh Only");
  });
  it("table rows, discount and GST reconcile exactly to the recorded folio total", () => {
    const doc = buildInvoiceDocument({ booking });
    expect(doc.tableLines.reduce((s, r) => s + r.amount, 0) - doc.totals.discount + doc.totals.taxes).toBe(4550);
    expect(doc.totals.balance).toBe(0);
    expect(doc.totals.taxable).toBe(4333);
  });
  it("room numbers, days, SAC and pre-tax rate stay on their original room lines", () => {
    const item = { id: "room-line", room_type: "Deluxe Double Room", rooms: 1, rate: 2500, nights: 2, check_in: booking.check_in, check_out: booking.check_out, adults: 2, children: 0 } as any;
    const doc = buildInvoiceDocument({ booking, items: [item], roomLabels: { "room-line": "201" } });
    expect(doc.tableLines[0]?.rooms).toBe("201");
    expect(doc.tableLines[0]?.qty).toBe(2);
    expect(doc.tableLines[0]?.sac).toBe("996311");
    expect(doc.tableLines[0]?.rate).toBe(2380.95);
  });
  it("billing edits reject malformed GSTIN before saving", () => {
    expect(invoiceBillingSchema.safeParse({ company_name: "Company", gst_number: "wrong" }).success).toBe(false);
    expect(invoiceBillingSchema.parse({ company_name: " Company ", gst_number: "37aaecl2341l1zf" }).gst_number).toBe("37AAECL2341L1ZF");
  });
});