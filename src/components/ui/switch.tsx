import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

/**
 * Luxury switch — visible OFF state (gray with border), gold ON state.
 * Used across all toggles for accessible contrast.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-gradient-to-br data-[state=checked]:from-[oklch(0.86_0.13_85)] data-[state=checked]:to-[oklch(0.72_0.14_75)] data-[state=checked]:border-[oklch(0.82_0.13_82/0.7)]",
      "data-[state=unchecked]:bg-muted data-[state=unchecked]:border-border",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full shadow-md ring-0 transition-transform",
        "data-[state=checked]:translate-x-5 data-[state=checked]:bg-charcoal",
        "data-[state=unchecked]:translate-x-0.5 data-[state=unchecked]:bg-foreground/80",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
