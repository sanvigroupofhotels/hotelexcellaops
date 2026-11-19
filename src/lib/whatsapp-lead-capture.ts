import { validatePhoneNumber, normalizePhoneNumber } from "@/lib/phone";

export function canCaptureWhatsAppLead(_name: string, phone: string, rooms: number, checkIn: string, checkOut: string) {
  return canShowWhatsAppPrice(phone, rooms) && checkOut > checkIn;
}

export function canShowWhatsAppPrice(phone: string, rooms: number) {
  return validatePhoneNumber(normalizePhoneNumber(phone)) && rooms > 0;
}