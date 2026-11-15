/**
 * OTA / aggregator system email blacklist.
 * These addresses belong to the channel (FabHotels, Hotelzify, …), never the
 * guest. They must never be stored as guest contact or used to match customers.
 */
export const OTA_EMAIL_DOMAINS = [
  "fabhotels.com", "hotelzify.com", "booking.com", "agoda.com", "makemytrip.com",
  "goibibo.com", "expedia.com", "yatra.com", "airbnb.com", "cleartrip.com",
];
export const SYSTEM_EMAIL_HANDLES = ["inventory", "reservations", "reservation", "support", "admin", "noreply", "no-reply", "donotreply", "do-not-reply", "bookings"];

export function isOtaSystemEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  if (!e.includes("@")) return false;
  const [local, domain] = e.split("@");
  if (OTA_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  return SYSTEM_EMAIL_HANDLES.includes(local);
}

/** Strip "Voucher No:", "#", "/" and whitespace so the same OTA ref always matches. */
export function normalizeExternalRef(ref: string | null | undefined): string {
  return (ref ?? "")
    .replace(/^[\s/#:]*(voucher|booking|ref(erence)?)\s*(no|id|number)?\.?\s*[:#-]?\s*/i, "")
    .replace(/[\s#/:]/g, "")
    .toUpperCase();
}
