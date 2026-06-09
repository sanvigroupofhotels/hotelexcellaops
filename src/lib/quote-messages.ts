/** Minimal quote-side WhatsApp helpers shared by the quote detail page menu. */
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

export function quotePaymentReminderMessage(q: any) {
  return [
    `Greetings from Hotel Excella ✨`,
    ``,
    `Dear ${q.guest_name},`,
    ``,
    `This is a friendly reminder regarding your quotation.`,
    ``,
    `📌 Quote Ref: ${q.reference_code}`,
    `🏨 Stay: ${fmtDate(q.check_in)} to ${fmtDate(q.check_out)}`,
    `💰 Total: ${inr(Number(q.total))}`,
    ``,
    `Please confirm the booking at your earliest convenience.`,
    ``,
    `Warm Regards,`,
    `Hotel Excella Reservations Team`,
  ].join("\n");
}

export function quoteCheckInWelcomeMessage(q: any) {
  return [
    `Dear ${q.guest_name}`,
    ``,
    `Looking forward to welcoming you at Hotel Excella for your upcoming stay (${fmtDate(q.check_in)}).`,
    ``,
    `For property details: https://hotelexcella.in/guest`,
    ``,
    `Warm Regards,`,
    `Hotel Excella Team`,
  ].join("\n");
}

export function quoteCheckOutThankYouMessage(q: any) {
  return [
    `Dear ${q.guest_name},`,
    ``,
    `Thank you for considering Hotel Excella.`,
    ``,
    `We hope to host you soon.`,
    ``,
    `Warm Regards,`,
    `Hotel Excella Team`,
  ].join("\n");
}

export function waLink(phone: string | null | undefined, text?: string) {
  const num = (phone ?? "").replace(/[^0-9]/g, "");
  return text ? `https://wa.me/${num}?text=${encodeURIComponent(text)}` : `https://wa.me/${num}`;
}
