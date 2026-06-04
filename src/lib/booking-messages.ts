import type { BookingRow } from "@/lib/bookings-api";

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

function roomSummary(b: BookingRow) {
  return b.room_details && b.room_details.trim() ? b.room_details : `${b.guests} Guest${b.guests === 1 ? "" : "s"}`;
}

export function confirmationMessage(b: BookingRow, items?: any[]) {
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
      stayLines.push(`• Check-in: ${fmtDate(it.check_in)} | 1:00 PM`);
      stayLines.push(`• Check-out: ${fmtDate(it.check_out)} | 11:00 AM`);
      stayLines.push(`• Nights: ${it.nights}`);
      stayLines.push(`• Breakfast: ${it.breakfast_included ? "Included" : "Not Included"}`);
      stayLines.push(`• Subtotal: ${inr(Number(it.subtotal))}`);
      stayLines.push(``);
    });
  } else {
    stayLines.push(`🏨 Stay Details`);
    stayLines.push(`• Check-in: ${fmtDate(b.check_in)} | 1:00 PM`);
    stayLines.push(`• Check-out: ${fmtDate(b.check_out)} | 11:00 AM`);
    stayLines.push(`• Guests: ${b.guests}`);
    stayLines.push(`• Room(s): ${roomSummary(b)}`);
    stayLines.push(``);
  }

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
    `💰 Booking Amount`,
    `• Total Amount: ${inr(Number(b.amount))}`,
    ...(Number(b.advance_paid || 0) > 0
      ? [
          `• Advance Paid: ${inr(Number(b.advance_paid))}`,
          `• Balance Payable: ${inr(Math.max(0, Number(b.amount) - Number(b.advance_paid || 0)))}`,
        ]
      : []),
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

export function bookingWhatsAppLink(b: BookingRow, text: string) {
  const phone = (b.phone ?? "").replace(/[^0-9]/g, "");
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
