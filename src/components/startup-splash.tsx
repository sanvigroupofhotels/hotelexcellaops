import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import crest from "@/assets/pwa-icon-512.png";

/** A visual reveal only: never delays auth, navigation or background loading. */
export function StartupSplash() {
  const [visible, setVisible] = useState(true);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setVisible(false), reduced ? 150 : 1700);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible || /^\/(\.well-known|\.lovable|mcp|api)(\/|\.|$)/.test(pathname)) return null;

  return (
    <div className="startup-splash" aria-hidden="true" data-startup-splash>
      <div className="startup-splash-mark">
        <img src={crest} alt="" width={112} height={112} className="h-28 w-28 rounded-lg" fetchPriority="high" />
        <span className="font-display text-3xl text-gold">Hotel Excella</span>
        <span className="text-xs text-muted-foreground">Visakhapatnam</span>
        <span className="startup-splash-line" />
      </div>
    </div>
  );
}