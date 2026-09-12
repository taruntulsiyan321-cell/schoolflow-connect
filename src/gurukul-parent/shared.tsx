import { clsx, type ClassValue } from "clsx";
import { withAlpha } from "@/lib/colorAlpha";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const ACCENT = "hsl(var(--primary))";
// `ACCENT_LIGHT` (`#34d399`) and `ACCENT_DIM` (`#3b5bdb20`) were deleted with
// the shadow palette: both were dark-theme values, and grep found ZERO callers
// for either — exported, never imported, and carrying a comment that called
// one of them "emerald" after the value beside it had become a token.

export function InitialsAvatar({ name, size = "md", color }: { name: string; size?: "sm" | "md" | "lg"; color?: string }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const sz = { sm: "w-7 h-7 text-[9px]", md: "w-9 h-9 text-xs", lg: "w-12 h-12 text-sm" }[size];
  const bg = color ?? "hsl(var(--primary))";
  return (
    <div className={`${sz} rounded-[2px] flex items-center justify-center font-black text-foreground shrink-0`} style={{ background: `${withAlpha(bg, 0.19)}`, color: bg }}>
      {initials}
    </div>
  );
}

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

export function GradeChip({ grade }: { grade: string }) {
  const color = grade.startsWith("A+") ? "hsl(var(--primary))" : grade.startsWith("A") ? "hsl(var(--success))" : grade.startsWith("B") ? "hsl(var(--primary))" : grade.startsWith("C") ? "hsl(var(--warning))" : "hsl(var(--destructive))";
  return (
    <span className="text-[10px] font-black px-2 py-0.5 rounded-lg" style={{ background: `${withAlpha(color, 0.13)}`, color }}>{grade}</span>
  );
}

export function ScoreBar({ value, max, color = ACCENT }: { value: number; max: number; color?: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] font-bold tabular-nums shrink-0" style={{ color }}>{pct}%</span>
    </div>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-surface border border-border/70 rounded-[2px]", className)}>
      {children}
    </div>
  );
}

export function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="text-sm font-bold text-foreground">{title}</div>
      {action}
    </div>
  );
}
