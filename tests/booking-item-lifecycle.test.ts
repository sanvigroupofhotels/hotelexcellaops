import { describe, expect, it } from "vitest";
import {
  deriveBookingStatusFromItems,
  itemStatusForBookingStatus,
} from "../src/lib/booking-item-lifecycle";

const items = (...statuses: string[]) => statuses.map((s) => ({ item_status: s }));

describe("booking item lifecycle — derived parent status", () => {
  it("1. multi-room individual check-in makes the booking Checked-In", () => {
    expect(deriveBookingStatusFromItems(items("Checked-In", "Confirmed", "Confirmed"), "Confirmed"))
      .toBe("Checked-In");
  });

  it("2. multi-room individual check-out keeps the booking active for the rest", () => {
    expect(deriveBookingStatusFromItems(items("Checked-In", "Checked-In", "Checked-Out"), "Checked-In"))
      .toBe("Checked-In");
  });

  it("3. reverting the only check-in returns to the pre-arrival status", () => {
    expect(deriveBookingStatusFromItems(items("Confirmed"), "Checked-In")).toBeNull();
  });

  it("4. reverting a check-out re-activates the booking", () => {
    expect(deriveBookingStatusFromItems(items("Checked-In", "Checked-Out"), "Checked-Out"))
      .toBe("Checked-In");
  });

  it("5. partial arrival: one room in-house, two still to arrive", () => {
    expect(deriveBookingStatusFromItems(items("Checked-In", "Confirmed"), "Advance Paid"))
      .toBe("Checked-In");
  });

  it("6. partial departure: 103 out, 101/102 in-house → booking stays Checked-In", () => {
    expect(deriveBookingStatusFromItems(items("Checked-Out", "Checked-In", "Checked-In"), "Checked-In"))
      .toBe("Checked-In");
  });

  it("7. all rooms departed → booking Checked-Out", () => {
    expect(deriveBookingStatusFromItems(items("Checked-Out", "Checked-Out", "Checked-Out"), "Checked-In"))
      .toBe("Checked-Out");
  });

  it("8. a closed 'Stay Completed' booking is never reopened as Checked-Out", () => {
    expect(deriveBookingStatusFromItems(items("Checked-Out"), "Stay Completed")).toBe("Stay Completed");
  });

  it("9. removed rooms are ignored in derivation", () => {
    expect(deriveBookingStatusFromItems(items("Removed", "Checked-In"), "Checked-In")).toBe("Checked-In");
    expect(deriveBookingStatusFromItems(items("Removed", "Removed"), "Confirmed")).toBeNull();
  });

  it("10. fully cancelled / no-show items derive the terminal booking status", () => {
    expect(deriveBookingStatusFromItems(items("Cancelled", "Cancelled"), "Confirmed")).toBe("Cancelled");
    expect(deriveBookingStatusFromItems(items("No-Show", "No-Show"), "Confirmed")).toBe("No-Show");
  });

  it("11. pre-arrival payment statuses are preserved (payment engine owns them)", () => {
    for (const s of ["Draft", "Pending", "Confirmed", "Advance Paid", "Full Paid"]) {
      expect(deriveBookingStatusFromItems(items("Confirmed", "Confirmed"), s)).toBeNull();
    }
  });

  it("12. bookings with no items never get a derived status", () => {
    expect(deriveBookingStatusFromItems([], "Checked-In")).toBeNull();
  });

  it("13. booking→item fan-out mapping (BJP Aditya root cause)", () => {
    expect(itemStatusForBookingStatus("Checked-In")).toBe("Checked-In");
    expect(itemStatusForBookingStatus("Checked-Out")).toBe("Checked-Out");
    expect(itemStatusForBookingStatus("Stay Completed")).toBe("Checked-Out");
    expect(itemStatusForBookingStatus("Cancelled")).toBe("Cancelled");
    expect(itemStatusForBookingStatus("No-Show")).toBe("No-Show");
    expect(itemStatusForBookingStatus("Advance Paid")).toBeNull();
  });
});
