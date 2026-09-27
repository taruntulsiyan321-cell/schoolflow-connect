import { type ClassValue, clsx } from "clsx";
import { withAlpha } from "@/lib/colorAlpha";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ACCENT = "hsl(var(--primary))";
// `ACCENT_BG` (`#3b5bdb18` — the shadow palette with an 8-digit alpha the
// 6-digit sweep could not see) and `ACCENT_MUTED` were deleted: grep found
// ZERO callers for either.

export function InitialsAvatar({ name, size = "md", color }: { name: string; size?: "sm" | "md" | "lg"; color?: string }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const sz = size === "sm" ? "w-7 h-7 text-[9px]" : size === "lg" ? "w-12 h-12 text-base" : "w-9 h-9 text-xs";
  const bg = color ?? ACCENT;
  return (
    <div className={cn("rounded-[2px] flex items-center justify-center font-black shrink-0", sz)}
      style={{ background: `${withAlpha(bg, 0.13)}`, color: bg }}>
      {initials}
    </div>
  );
}



