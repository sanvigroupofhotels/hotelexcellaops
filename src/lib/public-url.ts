/**
 * Returns the public (guest-facing) origin for share links.
 *
 * Both the Lovable preview host (`id-preview--<id>.lovable.app`) and the
 * stable project host (`project--<id>.lovable.app`) are auth-gated and
 * return 403 to unauthenticated visitors. The only public host that serves
 * the published build to guests is the configured published URL
 * (`hotelexcellaops.lovable.app`), so guest-portal share links must always
 * be built against that origin.
 */
const PUBLISHED_ORIGIN = "https://hotelexcellaops.lovable.app";

export function publicOrigin(): string {
  if (typeof window === "undefined") return PUBLISHED_ORIGIN;
  const host = window.location.hostname;
  // Custom domains other than *.lovable.app → trust as-is
  if (!host.endsWith(".lovable.app")) return window.location.origin;
  // Auth-gated Lovable hosts → always swap to the published origin
  if (host.startsWith("id-preview") || host.startsWith("project--")) return PUBLISHED_ORIGIN;
  return window.location.origin;
}
