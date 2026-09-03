import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    /** Colour for the filled portion. Replaces bg-primary; see the note below. */
    indicatorClassName?: string;
  }
>(({ className, value, indicatorClassName, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn("relative h-4 w-full overflow-hidden rounded-full bg-secondary", className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      // indicatorClassName REPLACES bg-primary rather than layering over it.
      // src/gurukul/theme.css:875 carries a rule commented "primary buttons"
      // whose third arm dropped the button qualifier —
      //   .gurukul-student [class*="bg-primary"]:not([class*="bg-primary/"])
      // — so inside the student panel it paints ANY element carrying
      // bg-primary with an !important gradient. That includes this indicator,
      // which is why a caller's [&>div]:bg-red-500 has never taken effect
      // there. twMerge drops bg-primary when a bg-* is passed here, so the
      // element stops matching that selector instead of trying to out-specify
      // an !important rule it cannot beat.
      className={cn("h-full w-full flex-1 bg-primary transition-all", indicatorClassName)}
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
