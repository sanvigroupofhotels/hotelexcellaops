/**
 * Booking Engine progress stepper — non-invasive UX overlay.
 *
 * Renders a four-step indicator on top of every /booking-engine/* page.
 * It reads the current route to derive the active step, allows backward
 * navigation to completed steps, and locks future steps. The component does
 * NOT mutate the booking flow or routes — it is purely informational.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "search", label: "Availability", paths: ["/booking-engine", "/booking-engine/", "/booking-engine/search"] },
  { key: "checkout", label: "Guest Details", paths: ["/booking-engine/checkout"] },
  { key: "review", label: "Review & Pay", paths: ["/booking-engine/review"] },
  { key: "confirmation", label: "Confirmation", paths: ["/booking-engine/confirmation"] },
] as const;

export function BookingEngineStepper() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Resolve current step by longest matching prefix.
  let activeIdx = 0;
  for (let i = STEPS.length - 1; i >= 0; i--) {
    if (STEPS[i].paths.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      activeIdx = i;
      break;
    }
  }

  return (
    <nav
      aria-label="Booking progress"
      className="sticky top-[57px] z-20 border-b border-border bg-background/95 backdrop-blur"
    >
      <ol className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-2 overflow-x-auto">
        {STEPS.map((s, i) => {
          const completed = i < activeIdx;
          const active = i === activeIdx;
          const clickable = completed;
          const node = (
            <div
              className={cn(
                "flex items-center gap-2 text-xs whitespace-nowrap",
                active && "text-gold font-medium",
                completed && "text-foreground hover:text-gold",
                !completed && !active && "text-muted-foreground/60",
              )}
            >
              <span
                className={cn(
                  "h-6 w-6 rounded-full border flex items-center justify-center text-[11px]",
                  active && "border-gold bg-gold-soft/40 text-gold",
                  completed && "border-gold/60 bg-gold/20 text-foreground",
                  !completed && !active && "border-border bg-card text-muted-foreground/60",
                )}
              >
                {completed ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
              <span className="sm:hidden">{s.label.split(" ")[0]}</span>
            </div>
          );
          return (
            <li key={s.key} className="flex items-center gap-2 shrink-0">
              {clickable ? (
                <Link
                  to={s.paths[0] as any}
                  className="focus:outline-none focus:ring-2 focus:ring-gold/40 rounded-full"
                >
                  {node}
                </Link>
              ) : (
                <div aria-current={active ? "step" : undefined}>{node}</div>
              )}
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "h-px w-6 sm:w-10",
                    completed ? "bg-gold/60" : "bg-border",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
