/** Shared staff day-use policy; dates remain equal in persisted bookings. */
export const DAY_USE_DEPARTURE_TIME = "18:00";

export function isDayUse(checkIn: string, checkOut: string) {
  return !!checkIn && checkIn === checkOut;
}

export function billableStayDays(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut || checkOut < checkIn) return 0;
  return Math.max(1, Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000));
}

export function departureAfterDateChange(checkIn: string, checkOut: string, current: string) {
  return isDayUse(checkIn, checkOut) && !current ? DAY_USE_DEPARTURE_TIME : current;
}

/** Hotel-local times, independent of the operator device's timezone. */
export function stayTimeISO(date: string, time: string) {
  return new Date(`${date}T${time}:00+05:30`).toISOString();
}

export function dayUseTimeLabel(timestamp?: string | null) {
  return timestamp ? new Date(timestamp).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }) : "Not provided";
}

/** An actual day-use checkout must find today's segment even before audit rolls. */
export function dayUseCheckoutDate(checkIn: string, checkOut: string, businessDate: string) {
  return isDayUse(checkIn, checkOut) && checkIn > businessDate ? checkIn : businessDate;
}