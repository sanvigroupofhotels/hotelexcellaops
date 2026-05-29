import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

/**
 * iOS-style switch — 44x26 track, 22x22 white thumb with subtle shadow.
 * Thumb stays flush inside the track on both ON/OFF (translates 18px).
 * Track uses a 1px border for clean edges; no clipping on Android Chrome.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer relative inline-flex h-[26px] w-[44px] shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-gold data-[state=checked]:border-gold",
      "data-[state=unchecked]:bg-muted",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] ring-0 transition-transform will-change-transform",
        "data-[state=checked]:translate-x-[19px] data-[state=unchecked]:translate-x-[1px]",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
