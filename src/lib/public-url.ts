/**
 * Returns the public (guest-facing) origin for share links.
 *
 * Both the Lovable preview host (`id-preview--<id>.lovable.app`) and the
 * stable project host (`project--<id>.lovable.app`) are auth-gated and
 * return 403 to unauthenticated visitors. The production custom domain
 * (`guest.hotelexcella.in`) is the public host that serves guest links,
 * so guest-portal share links must always be built
 * against that origin.
 */
const PUBLISHED_ORIGIN = "https://guest.hotelexcella.in";

export function publicOrigin(): string {
  if (typeof window === "undefined") return PUBLISHED_ORIGIN;
  const host = window.location.hostname;
  if (host === "guest.hotelexcella.in") return window.location.origin;
  // Operations and Booking Engine custom domains should still share guest links on guest.
  if (host === "ops.hotelexcella.in" || host === "book.hotelexcella.in") return PUBLISHED_ORIGIN;
  // Auth-gated Lovable hosts → always swap to the published origin
  if (host.startsWith("id-preview") || host.startsWith("project--")) return PUBLISHED_ORIGIN;
  return window.location.origin;
}

