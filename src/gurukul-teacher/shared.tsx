import { type ClassValue, clsx } from "clsx";
import { withAlpha } from "@/lib/colorAlpha";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const ACCENT = "hsl(var(--primary))";
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

export function GradeChip({ grade }: { grade: string | null }) {
  if (!grade) return null;
  const color =
    grade === "A+" ? "hsl(var(--success))" :
    grade === "A" ? "hsl(var(--primary))" :
    grade === "B+" ? "hsl(var(--warning))" :
    grade === "B" ? "hsl(var(--warning))" :
    grade === "C+" ? "hsl(var(--muted-foreground))" : "hsl(var(--destructive))";
  return (
    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
      style={{ background: `${withAlpha(color, 0.13)}`, color }}>
      {grade}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  const color =
    status === "present" ? "hsl(var(--success))" :
    status === "absent" ? "hsl(var(--destructive))" :
    status === "late" ? "hsl(var(--warning))" : "hsl(var(--muted-foreground))";
  return <div className="w-2 h-2 rounded-full" style={{ background: color }} />;
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-surface border border-border/70 rounded-[2px]", className)}>
      {children}
    </div>
  );
}

export function SectionHead({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 mb-4">
      <div>
        <div className="text-sm font-bold text-foreground">{title}</div>
        {subtitle && <div className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function StatBox({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-surface border border-border/70 rounded-[2px] p-4 text-center">
      <div className="text-xl font-black tabular-nums" style={{ color: color ?? "#fff" }}>{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
