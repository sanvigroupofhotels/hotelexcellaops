/** Format a stored 24-hour hotel time (HH:mm) for guest-facing display. */
export function formatHotelTime(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm || "");
  if (!match) return hhmm;

  let hour = Number(match[1]);
  const minutes = match[2];
  const period = hour >= 12 ? "PM" : "AM";
  hour %= 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minutes} ${period}`;
}