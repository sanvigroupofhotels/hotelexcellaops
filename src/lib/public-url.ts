/**
 * Returns the public (guest-facing) origin for share links.
 *
 * On Lovable preview URLs (`id-preview--<id>.lovable.app` or
 * `id-preview-<sha>--<id>.lovable.app`), `window.location.origin` is
 * auth-gated and redirects guests to the Lovable auth bridge. For
 * guest-facing links (Guest Portal, payment links) we always want the
 * stable, public published URL instead.
 */
const PROJECT_ID = "bf9d317a-170f-4eb0-82c9-ac90cf77e6ab";
const STABLE_PUBLIC_ORIGIN = `https://project--${PROJECT_ID}.lovable.app`;

export function publicOrigin(): string {
  if (typeof window === "undefined") return STABLE_PUBLIC_ORIGIN;
  const host = window.location.hostname;
  // Custom domain or stable published URL → use as-is
  if (!host.endsWith(".lovable.app")) return window.location.origin;
  if (host.startsWith("id-preview")) return STABLE_PUBLIC_ORIGIN;
  return window.location.origin;
}
