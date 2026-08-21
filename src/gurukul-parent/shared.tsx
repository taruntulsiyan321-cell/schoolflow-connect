import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const ACCENT = "#3b5bdb"; // emerald
export const ACCENT_LIGHT = "#34d399";
export const ACCENT_DIM = "#3b5bdb20";

export function InitialsAvatar({ name, size = "md", color }: { name: string; size?: "sm" | "md" | "lg"; color?: string }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const sz = { sm: "w-7 h-7 text-[9px]", md: "w-9 h-9 text-xs", lg: "w-12 h-12 text-sm" }[size];
  const bg = color ?? "#3b5bdb";
  return (
    <div className={`${sz} rounded-xl flex items-center justify-center font-black text-foreground shrink-0`} style={{ background: `${bg}30`, color: bg }}>
      {initials}
    </div>
  );
}

export function PriorityBadge({ priority }: { priority: "normal" | "important" | "urgent" }) {
  const map = {
    normal: { bg: "bg-black/8", text: "text-muted-foreground", label: "Normal" },
    important: { bg: "bg-[#c08a3a]/15", text: "text-[#c08a3a]", label: "Important" },
    urgent: { bg: "bg-[#cc5069]/15", text: "text-[#cc5069]", label: "Urgent" },
  };
  const s = map[priority];
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${s.bg} ${s.text}`}>{s.label}</span>
  );
}

export function GradeChip({ grade }: { grade: string }) {
  const color = grade.startsWith("A+") ? "#3b5bdb" : grade.startsWith("A") ? "#4aa87a" : grade.startsWith("B") ? "#6366f1" : grade.startsWith("C") ? "#c08a3a" : "#cc5069";
  return (
    <span className="text-[10px] font-black px-2 py-0.5 rounded-lg" style={{ background: `${color}20`, color }}>{grade}</span>
  );
}

export function ScoreBar({ value, max, color = ACCENT }: { value: number; max: number; color?: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 bg-black/5 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] font-bold tabular-nums shrink-0" style={{ color }}>{pct}%</span>
    </div>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card border border-black/7 rounded-2xl", className)}>
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