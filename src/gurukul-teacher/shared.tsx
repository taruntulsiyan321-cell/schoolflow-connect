import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const ACCENT = "#3b5bdb";
export const ACCENT_BG = "#3b5bdb18";
export const ACCENT_MUTED = "#3b5bdb";

export function InitialsAvatar({ name, size = "md", color }: { name: string; size?: "sm" | "md" | "lg"; color?: string }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const sz = size === "sm" ? "w-7 h-7 text-[9px]" : size === "lg" ? "w-12 h-12 text-base" : "w-9 h-9 text-xs";
  const bg = color ?? ACCENT;
  return (
    <div className={cn("rounded-xl flex items-center justify-center font-black shrink-0", sz)}
      style={{ background: `${bg}20`, color: bg }}>
      {initials}
    </div>
  );
}

export function GradeChip({ grade }: { grade: string | null }) {
  if (!grade) return null;
  const color =
    grade === "A+" ? "#10b981" :
    grade === "A" ? "#6366f1" :
    grade === "B+" ? "#f59e0b" :
    grade === "B" ? "#c08a3a" :
    grade === "C+" ? "#78788c" : "#cc5069";
  return (
    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
      style={{ background: `${color}20`, color }}>
      {grade}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  const color =
    status === "present" ? "#10b981" :
    status === "absent" ? "#cc5069" :
    status === "late" ? "#f59e0b" : "#78788c";
  return <div className="w-2 h-2 rounded-full" style={{ background: color }} />;
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-[#131316] border border-white/7 rounded-2xl", className)}>
      {children}
    </div>
  );
}

export function SectionHead({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 mb-4">
      <div>
        <div className="text-sm font-bold text-white">{title}</div>
        {subtitle && <div className="text-[10px] text-[#78788c] mt-0.5">{subtitle}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function StatBox({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
      <div className="text-xl font-black tabular-nums" style={{ color: color ?? "#fff" }}>{value}</div>
      <div className="text-[10px] text-[#78788c] mt-0.5">{label}</div>
    </div>
  );
}
