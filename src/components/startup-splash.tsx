import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import crest from "@/assets/excella-crown-white-bg.webp.asset.json";
import { claimStartupReveal, startupRevealAllowed } from "@/lib/startup-reveal";

/** A visual reveal only: never delays auth, navigation or background loading. */
export function StartupSplash() {
  const [visible, setVisible] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    if (!startupRevealAllowed(pathname)) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !claimStartupReveal(window.sessionStorage)) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 1900);
    return () => window.clearTimeout(timer);
    // Root stays mounted across navigation; redirects must not restart the reveal.
  }, []);

  if (!visible || !startupRevealAllowed(pathname)) return null;

  return (
    <div className="startup-splash" aria-hidden="true" data-startup-splash>
      <div className="startup-splash-mark">
        <img src={crest.url} alt="" width={960} height={620} className="startup-crown" fetchPriority="high" onError={() => setVisible(false)} />
        <img src={crest.url} alt="" width={960} height={620} className="startup-crown startup-crown-sheen" />
      </div>
    </div>
  );
}