export const STARTUP_REVEAL_KEY = "excella-crown-reveal-v1";

export function startupRevealAllowed(pathname: string) {
  return !/^\/(\.well-known|\.lovable|mcp|api|oauth|auth\/callback)(\/|\.|$)/.test(pathname);
}

export function claimStartupReveal(storage: Pick<Storage, "getItem" | "setItem">) {
  try {
    if (storage.getItem(STARTUP_REVEAL_KEY)) return false;
    storage.setItem(STARTUP_REVEAL_KEY, "seen");
  } catch {
    // Storage restrictions must never prevent entry to the hotel application.
  }
  return true;
}

/** Delay the login reveal until the once-per-session splash starts fading. */
export function entranceDelaySeconds() {
  if (typeof window === "undefined") return 0;
  try {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pending = !window.sessionStorage.getItem(STARTUP_REVEAL_KEY);
    return pending && !reduced ? 1.65 : 0;
  } catch {
    return 0;
  }
}
