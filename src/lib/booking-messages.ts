import type { BookingRow } from "@/lib/bookings-api";
import { computePricing } from "@/lib/pricing";
import { getOpsTimeLabels } from "@/lib/check-times";

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

function roomSummary(b: BookingRow) {
  return b.room_details && b.room_details.trim() ? b.room_details : `${b.guests} Guest${b.guests === 1 ? "" : "s"}`;
}

export function confirmationMessage(b: BookingRow, items?: any[]) {
  const t = getOpsTimeLabels();
  const multi = items && items.length > 0;
  const stayLines: string[] = [];
  if (multi) {
    stayLines.push(`🏨 Stay Details (${items!.length} Room${items!.length === 1 ? "" : "s"} / Segment${items!.length === 1 ? "" : "s"})`);
    stayLines.push(``);
    items!.forEach((it: any, i: number) => {
      const occ = `${it.adults || 0} Adult${(it.adults || 0) === 1 ? "" : "s"}${(it.children || 0) > 0 ? ` + ${it.children} Child${it.children === 1 ? "" : "ren"}` : ""}${it.extra_bed ? ` + ${it.extra_bed} Extra Bed` : ""}`;
      stayLines.push(`Room ${i + 1}`);
      stayLines.push(`• Room Type: ${it.room_type}`);
      stayLines.push(`• Guests: ${occ}`);
      stayLines.push(`• Check-in: ${fmtDate(it.check_in)} | ${t.checkIn}`);
      stayLines.push(`• Check-out: ${fmtDate(it.check_out)} | ${t.checkOut}`);
      stayLines.push(`• Nights: ${it.nights}`);
      if (it.breakfast_included) stayLines.push(`• Breakfast: Included`);
      stayLines.push(`• Subtotal: ${inr(Number(it.subtotal))}`);
      stayLines.push(``);
    });
  } else {
    stayLines.push(`🏨 Stay Details`);
    stayLines.push(`• Check-in: ${fmtDate(b.check_in)} | ${t.checkIn}`);
    stayLines.push(`• Check-out: ${fmtDate(b.check_out)} | ${t.checkOut}`);
    stayLines.push(`• Guests: ${b.guests}`);
    stayLines.push(`• Room(s): ${roomSummary(b)}`);
    stayLines.push(``);
  }

  // Pricing breakdown — same model as Quotes / Invoices / Guest Portal.
  // Itemise extras (Early CI / Late CO / Pet / Extra Adults / Drivers) via computePricing.
  const discount = Number(b.discount || 0);
  const taxRate = Number((b as any).tax_rate ?? 0.05);
  const taxesIncluded = !!(b as any).taxes_included;
  const overrideTotal = (b as any).total_override ?? null;
  let pricing: any = null;
  try {
    pricing = items && items.length > 0
      ? computePricing(items as any, discount, taxRate, { totalOverride: overrideTotal, taxesIncluded })
      : null;
  } catch { pricing = null; }

  const subtotal = Number((b as any).subtotal || 0);
  const taxes = Number((b as any).taxes || 0);
  const total = Number(b.amount || 0);
  const paid = Number(b.advance_paid || 0);
  const balance = Math.max(0, total - paid);

  const showBreakdown = subtotal > 0 || taxes > 0;
  const pricingLines = showBreakdown
    ? [
        `💰 Pricing Breakdown`,
        `• Room Charges: ${inr(pricing?.mainStayCharges ?? (subtotal + discount))}`,
        ...((pricing?.additionalLineItems ?? []).length > 0
          ? [`• Additional Stay Charges:`, ...pricing.additionalLineItems.map((li: any) => `   – ${li.label}: ${inr(li.value)}`)]
          : []),
        ...(discount > 0 || (pricing?.discount ?? 0) > 0 ? [`• Discount: -${inr(Math.max(discount, pricing?.discount ?? 0))}`] : []),
        `• Taxable Amount: ${inr(subtotal)}`,
        `• Taxes${taxRate > 0 ? ` (${Math.round(taxRate * 100)}%)` : ""}: ${inr(taxes)}`,
        `• Final Booking Amount: ${inr(total)}`,
      ]
    : [
        `💰 Booking Amount`,
        `• Total Amount: ${inr(total)}`,
      ];

  return [
    `Greetings from Hotel Excella ✨`,
    ``,
    `Dear ${b.guest_name},`,
    ``,
    `Your booking is confirmed.`,
    ``,
    `📌 Booking Ref: ${b.booking_reference}`,
    ``,
    ...stayLines,
    ...pricingLines,
    ``,
    `📊 Payment Summary`,
    `• Total Booking Amount: ${inr(total)}`,
    `• Amount Paid: ${inr(paid)}`,
    `• Balance Due: ${inr(balance)}`,
    ``,
    `Property Information:`,
    `https://hotelexcella.in/guest`,
    ``,
    `Regards,`,
    `Hotel Excella`,
  ].join("\n");
}

export function paymentReminderMessage(b: BookingRow, pendingAmount?: number) {
  const amt = pendingAmount ?? Number(b.amount);
  return [
    `Greetings from Hotel Excella ✨`,
    ``,
    `Dear ${b.guest_name},`,
    ``,
    `This is a friendly reminder regarding your upcoming reservation.`,
    ``,
    `📌 Booking Ref: ${b.booking_reference}`,
    ``,
    `🏨 Stay Dates`,
    `${fmtDate(b.check_in)} to ${fmtDate(b.check_out)}`,
    ``,
    `💰 Pending Amount`,
    `${inr(amt)}`,
    ``,
    `We request you to complete the payment at your earliest convenience.`,
    ``,
    `If payment has already been made, please ignore this message.`,
    ``,
    `Warm Regards,`,
    `Hotel Excella Reservations Team`,
  ].join("\n");
}

export function checkInWelcomeMessage(b: BookingRow) {
  return [
    `Welcome to Hotel Excella.`,
    ``,
    `For Information & Assistance:`,
    `https://hotelexcella.in/guest`,
    ``,
    `For Lunch / Dinner:`,
    `https://hotelexcella.in/orderfood`,
    ``,
    `Breakfast:`,
    `Please contact Reception`,
    ``,
    `We wish you a pleasant and comfortable stay.`,
  ].join("\n");
}

export function checkOutThankYouMessage(b: BookingRow) {
  return [
    `Dear ${b.guest_name},`,
    ``,
    `If you enjoyed your stay, we would greatly appreciate your review:`,
    ``,
    `https://hotelexcella.in/review`,
    ``,
    `We look forward to hosting you again.`,
    ``,
    `Warm Regards,`,
    `Hotel Excella`,
  ].join("\n");
}

/**
 * Shared payment / booking portal link message. Used by both Booking Detail
 * ("Share Payment Link") and House View ("Payment Link"). Any change to the
 * copy must happen here — do not duplicate this template at call sites.
 */
export function paymentLinkMessage(b: BookingRow, portalUrl: string) {
  const guestName = (b.guest_name || "").trim() || "Guest";
  return [
    `Dear ${guestName},`,
    ``,
    `Thank you for choosing Hotel Excella.`,
    ``,
    `Below is your booking information:`,
    ``,
    portalUrl,
    ``,
    `Booking Ref: ${b.booking_reference}`,
    ``,
    `Using this portal you can:`,
    `• Make Payments`,
    `• Upload Documents`,
    `• Access In-House Services after Check-In:`,
    `   – Order Food`,
    `   – Raise Complaints`,
    `   – Submit a Review`,
    ``,
    `Warm Regards,`,
    `Hotel Excella`,
  ].join("\n");
}

import { phoneToWaDigits } from "@/lib/phone";

export function bookingWhatsAppLink(b: BookingRow, text: string) {
  const phone = phoneToWaDigits(b.phone);
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
