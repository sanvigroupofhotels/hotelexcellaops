/**
 * WhatsApp link helper.
 *
 * Legacy note: this module used to host quote-side message builders. Quotes
 * were retired in HEOS v1.0 Shipment 3B, so only the shared `waLink` helper
 * remains — it is used by the Booking Detail WhatsApp menu.
 */
import { phoneToWaDigits } from "@/lib/phone";

export function waLink(phone: string | null | undefined, text?: string) {
  const num = phoneToWaDigits(phone);
  return text ? `https://wa.me/${num}?text=${encodeURIComponent(text)}` : `https://wa.me/${num}`;
}
