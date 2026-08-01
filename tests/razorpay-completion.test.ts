import { describe, it, expect } from "vitest";
import { splitRazorpayCapture } from "@/lib/razorpay-completion.server";

/**
 * UAT — Financial Consistency: the convenience-fee split must behave
 * identically for FULL and PARTIAL Razorpay payments.
 */
describe("splitRazorpayCapture", () => {
  it("splits the fee on a PARTIAL payment (order ₹3000 + ₹90 fee)", () => {
    expect(splitRazorpayCapture({ amountInr: 3090, orderAmountInr: 3000, outstandingInr: 12000 }))
      .toEqual({ primaryAmount: 3000, feeAmount: 90 });
  });

  it("splits the fee on a FULL payment (order ₹12000 + ₹354 fee)", () => {
    expect(splitRazorpayCapture({ amountInr: 12354, orderAmountInr: 12000, outstandingInr: 12000 }))
      .toEqual({ primaryAmount: 12000, feeAmount: 354 });
  });

  it("records no fee when the capture matches the order exactly", () => {
    expect(splitRazorpayCapture({ amountInr: 2500, orderAmountInr: 2500, outstandingInr: 9000 }))
      .toEqual({ primaryAmount: 2500, feeAmount: 0 });
  });

  it("splits tiny fees above dust tolerance", () => {
    expect(splitRazorpayCapture({ amountInr: 1.03, orderAmountInr: 1, outstandingInr: 500 }))
      .toEqual({ primaryAmount: 1, feeAmount: 0.03 });
  });

  it("falls back to outstanding balance when no order row exists", () => {
    expect(splitRazorpayCapture({ amountInr: 5100, orderAmountInr: null, outstandingInr: 5000 }))
      .toEqual({ primaryAmount: 5000, feeAmount: 100 });
    expect(splitRazorpayCapture({ amountInr: 2000, orderAmountInr: null, outstandingInr: 5000 }))
      .toEqual({ primaryAmount: 2000, feeAmount: 0 });
  });
});
