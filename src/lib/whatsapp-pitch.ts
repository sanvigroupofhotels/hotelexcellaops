/** Front-desk WhatsApp welcome pitch — greeting depends on the signed-in login. */
export const WHATSAPP_BOOKING_URL = "https://book.hotelexcella.in/whatsapp-booking";
export const RECEPTION_WA = "919985908131";

export function pitchGreeting(emailOrUsername: string | null | undefined): string {
  const u = (emailOrUsername ?? "").toLowerCase().split("@")[0].trim();
  if (u === "shoban.india") return "I am Shobhan, Owner Hotel Excella, Vizag";
  if (u === "kilimshetty.kumar") return "I am Dileep, Owner Hotel Excella, Vizag";
  return "I am Manager, Hotel Excella, Vizag";
}

export function buildPitch(emailOrUsername: string | null | undefined): string {
  return `${pitchGreeting(emailOrUsername)}

*Book directly (best price):*
${WHATSAPP_BOOKING_URL}

*Hotel website:*
HotelExcella.in

*Hotel location:*
https://maps.app.goo.gl/kkWfTf4Hj6AjwRnL6

*Room photos:*
https://drive.google.com/drive/folders/1K-yBziTV9Z33aTyYqtt6x3VNVybSlH44

*Oak room Tour:*
https://drive.google.com/file/d/18KMWmFBZO2KnUArLgPYTsn0WICHBPi1h/view?usp=drivesdk

*Maple room Tour:*
https://drive.google.com/file/d/18KMWmFBZO2KnUArLgPYTsn0WICHBPi1h/view?usp=drivesdk

*Benefits:*
- Hotel Excella is 200 mts walkable to the beach
- 500 mts to Jodugullapalem beach
- 700 mts to Tenneti Park
- 1 KM to Kailasagiri Ropeway Base Station
- 700 mts to Bangladeshi Ship Viewpoint
- Free High Speed Wifi
- 24*7 Front office Support
- Daily Housekeeping`;
}

export function waLink(phone: string, text: string): string {
  let d = phone.replace(/\D/g, "");
  if (d.length === 10) d = "91" + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}
