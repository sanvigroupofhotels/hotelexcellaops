// VAPID public key — safe to ship to the browser. The private key remains
// server-only and is read only by the push dispatch endpoint.
// Generated alongside VAPID_PRIVATE_KEY in project secrets.
export const VAPID_PUBLIC_KEY =
  "BB80Xrw3uvbXjOYfv0SYQ6bobbt4b31_PlQJknTeuAFW3oXlmNPoMmHRi-yMkf_37bN3iER58YHqmZ-6rfMpVRM";

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
