import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// `ACCENT_LIGHT` (`#34d399`) and `ACCENT_DIM` (`#3b5bdb20`) were deleted with
// the shadow palette: both were dark-theme values, and grep found ZERO callers
// for either — exported, never imported, and carrying a comment that called
// one of them "emerald" after the value beside it had become a token.


export function PriorityBadge({ priority }: { priority: "normal" | "important" | "urgent" }) {
  const map = {
    normal: { bg: "bg-muted/80", text: "text-muted-foreground", label: "Normal" },
    important: { bg: "bg-warning/15", text: "text-warning", label: "Important" },
    urgent: { bg: "bg-destructive/15", text: "text-destructive", label: "Urgent" },
  };
  const s = map[priority];
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${s.bg} ${s.text}`}>{s.label}</span>
  );
}



