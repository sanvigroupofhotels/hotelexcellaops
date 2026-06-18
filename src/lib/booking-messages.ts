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
    `We are pleased to confirm your reservation with Hotel Excella.`,
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
    `📍 Property Information`,
    `Property Guide:`,
    `https://hotelexcella.in/guest`,
    ``,
    `We look forward to hosting you and making your stay comfortable and memorable.`,
    ``,
    `Warm Regards,`,
    `Hotel Excella Reservations Team`,
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
    `Dear ${b.guest_name}`,
    ``,
    `Thank you for choosing our property for your stay.`,
    ``,
    `Please find some details that may be useful for you:`,
    ``,
    `For all details about the property during your stay:`,
    `https://hotelexcella.in/guest`,
    ``,
    `For Lunch and Dinner, please order from:`,
    `https://hotelexcella.in/orderfood`,
    ``,
    `Breakfast on adhoc basis:`,
    `Please contact 8859444555`,
    ``,
    `We wish you a pleasant and comfortable stay.`,
    ``,
    `Warm Regards,`,
    `Hotel Excella Team`,
  ].join("\n");
}

export function checkOutThankYouMessage(b: BookingRow) {
  return [
    `Dear ${b.guest_name},`,
    ``,
    `Thank you for staying with Hotel Excella.`,
    ``,
    `We hope you had a comfortable and pleasant stay with us.`,
    ``,
    `If you enjoyed your experience, we would greatly appreciate a review from you.`,
    ``,
    `⭐ Leave a Review:`,
    `https://hotelexcella.in/review`,
    ``,
    `Your feedback helps us improve our services and assists other travelers in choosing us.`,
    ``,
    `We look forward to welcoming you again in the future.`,
    ``,
    `Warm Regards,`,
    `Hotel Excella Team`,
  ].join("\n");
}

import { phoneToWaDigits } from "@/lib/phone";

export function bookingWhatsAppLink(b: BookingRow, text: string) {
  const phone = phoneToWaDigits(b.phone);
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
