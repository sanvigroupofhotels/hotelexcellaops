import { validatePhoneNumber, normalizePhoneNumber } from "@/lib/phone";

export function canCaptureWhatsAppLead(name: string, phone: string, rooms: number, checkIn: string, checkOut: string) {
  return name.trim().length >= 2 && validatePhoneNumber(normalizePhoneNumber(phone)) && rooms > 0 && checkOut > checkIn;
}