import type { CSSProperties, ReactNode } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { motion, AnimatePresence, useReducedMotion, type Variants } from "framer-motion";
import { progressionLevelProgress } from "@/academic/services/progressionMath";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Shared motion language for the whole app — every animated primitive below
 * pulls from these so motion feels like one system, not per-component
 * one-offs. Durations/easing tuned to read as "premium" (quick, soft
 * deceleration) rather than bouncy/toy-like.
 */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const springSnappy = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.6 };
export const springSoft = { type: "spring" as const, stiffness: 220, damping: 26, mass: 0.8 };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
};

/** Wrap a list's container with this + give each child `variants={fadeUp}` for a cascading entrance. */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } },
};

export function GlassCard({ children, className, glow, onClick, style }: {
  children: ReactNode; className?: string;
  glow?: "blue"|"cyan"|"amber"|"purple"|"green"|"rose";
  onClick?: () => void;
  /** Callers use this for stagger delays; forwarded to the motion element. */
  style?: CSSProperties;
}) {
  const reduceMotion = useReducedMotion();
  const glows: Record<string, string> = {
    blue:   "border-primary/20",
    cyan:   "border-info/20",
    amber:  "border-warning/20",
    purple: "border-accent/20",
    green:  "border-success/20",
    rose:   "border-destructive/20",
  };
  return (
    <motion.div
      onClick={onClick}
      style={style}
      className={cn(
        "rounded-2xl border bg-card/95 shadow-card backdrop-blur-sm",
        glow ? glows[glow] : "border-border/70",
        onClick && "cursor-pointer",
        className
      )}
      initial={reduceMotion ? undefined : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
      whileHover={onClick && !reduceMotion ? { y: -3, borderColor: "hsl(var(--primary) / 0.35)" } : undefined}
      whileTap={onClick && !reduceMotion ? { scale: 0.985, y: -1 } : undefined}
    >{children}</motion.div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 mb-4", className)}>
      <div className="w-1 h-4 rounded-full bg-primary" />
      <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{children}</span>
    </div>
  );
}

import { displaySubject } from "@/lib/academicPresentation";

const SUBJECT_COLOR_MAP: Record<string, string> = {
  Mathematics: "var(--color-math)",
  Physics: "var(--color-physics)",
  Chemistry: "var(--color-chemistry)",
  Biology: "var(--color-biology)",
  English: "var(--color-english)",
  Accountancy: "var(--color-biology)",
  "Business Studies": "var(--color-chemistry)",
  Economics: "var(--color-english)",
  Hindi: "var(--color-hindi)",
  Science: "var(--color-physics)",
  "Social Science": "var(--color-social)",
};

function getSubjectColorVar(subject: string): string {
  const label = displaySubject(subject) || subject;
  return SUBJECT_COLOR_MAP[label] ?? SUBJECT_COLOR_MAP[subject] ?? "var(--color-muted-foreground)";
}

export function SubjectBadge({ subject, color }: { subject: string; color?: string }) {
  const label = displaySubject(subject);
  if (!label) return null;
  const colorVar = color ?? getSubjectColorVar(subject);
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
      style={{ color: `hsl(${colorVar})`, borderColor: `hsl(${colorVar} / 0.3)`, background: `hsl(${colorVar} / 0.07)` }}>
      {label}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    "in-recovery":  { label: "In Recovery",  color: "var(--warning)", bg: "var(--warning) / 0.1" },
    // §10.8: the status a RECOVERY item reaches when it is finished. "Mastered"
    // told the student they are good at the concept; "Recovered" says the work
    // is done, which is the fact the badge is actually reporting.
    "mastered":     { label: "Recovered",    color: "var(--success)", bg: "var(--success) / 0.1" },
    "pending":      { label: "Pending",      color: "var(--destructive)", bg: "var(--destructive) / 0.1" },
    "active":       { label: "Active",       color: "var(--info)", bg: "var(--info) / 0.1" },
    "won":          { label: "Won",          color: "var(--success)", bg: "var(--success) / 0.1" },
    "lost":         { label: "Lost",         color: "var(--destructive)", bg: "var(--destructive) / 0.1" },
    "answered":     { label: "Answered",     color: "var(--success)", bg: "var(--success) / 0.1" },
    "submitted":    { label: "Submitted",    color: "var(--primary)", bg: "var(--primary) / 0.1" },
    "graded":       { label: "Graded",       color: "var(--info)", bg: "var(--info) / 0.1" },
    "in-progress":  { label: "In Progress",  color: "var(--warning)", bg: "var(--warning) / 0.1" },
    "not-started":  { label: "Not Started",  color: "var(--muted-foreground)", bg: "var(--muted-foreground) / 0.1" },
  };
  const s = map[status] ?? { label: status, color: "var(--muted-foreground)", bg: "var(--muted-foreground) / 0.1" };
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: `hsl(${s.color})`, background: `hsl(${s.bg})` }}>{s.label}</span>;
}

export function Avatar({ initials, color, size="md" }: { initials:string; color?:string; size?:"sm"|"md"|"lg" }) {
  const sizes = { sm: "w-7 h-7 text-[10px]", md: "w-9 h-9 text-xs", lg: "w-12 h-12 text-sm" };
  const colorVar = color ?? "var(--primary)";
  return (
    <motion.div className={cn("rounded-full flex items-center justify-center font-black text-foreground shrink-0", sizes[size])}
      style={{ background: `linear-gradient(135deg, hsl(${colorVar}), hsl(${colorVar} / 0.6))` }}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.08 }}
      transition={springSnappy}
    >
      {initials}
    </motion.div>
  );
}

export function ProgressRing({ score, size=80, color }: { score:number; size?:number; color?:string }) {
  const reduceMotion = useReducedMotion();
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, score)) / 100) * c;
  const colorVar = color ?? (score >= 80 ? "var(--info)" : score >= 60 ? "var(--warning)" : "var(--destructive)");
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={stroke} />
        <motion.circle cx={size/2} cy={size/2} r={r} fill="none" stroke={`hsl(${colorVar})`} strokeWidth={stroke}
          strokeDasharray={c} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px hsl(${colorVar}))` }}
          initial={reduceMotion ? undefined : { strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: EASE_OUT }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.span className="font-black tabular-nums" style={{ color: `hsl(${colorVar})`, fontSize: size * 0.22 }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.4 }}>
          {score}%
        </motion.span>
      </div>
    </div>
  );
}

export function ProgressBar({ value, max=100, color="var(--primary)", height="h-2" }: {
  value:number; max?:number; color?:string; height?:string;
}) {
  const pct = Math.min(100, (value/max)*100);
  return (
    <div className={cn("w-full rounded-full bg-muted overflow-hidden", height)}>
      <motion.div className="h-full rounded-full"
        style={{ background: `hsl(${color})` }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={springSoft} />
    </div>
  );
}

export function StatTile({ label, value, color, sub }: { label:string; value:string|number; color?:string; sub?:string }) {
  return (
    <motion.div className="bg-muted/70 rounded-xl px-3 py-2.5 border border-border"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, background: "hsl(var(--secondary))" }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <motion.div
        key={String(value)}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mt-0.5 text-xl font-black tabular-nums"
        style={{ color: color ? `hsl(${color})` : "hsl(var(--foreground))" }}>{value}</motion.div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </motion.div>
  );
}

/** Level progress from ProgressionService — mirrors SQL triangular curve when fields omitted. */
export function XPBar({
  xp,
  level,
  xpIntoLevel,
  xpToNext,
  progressPct,
}: {
  xp: number;
  level: number;
  xpIntoLevel?: number;
  xpToNext?: number;
  progressPct?: number;
}) {
  const derived = progressionLevelProgress(xp, level);
  const into = Math.max(0, xpIntoLevel ?? derived.xpIntoLevel);
  const remaining = Math.max(0, xpToNext ?? derived.xpToNextLevel);
  const span = into + remaining;
  const progress =
    progressPct != null
      ? Math.min(100, Math.max(0, progressPct))
      : span > 0
        ? Math.min(100, Math.round((into / span) * 100))
        : derived.levelProgressPct;
  const label =
    span > 0 ? `${into}/${span} XP` : `${Math.max(0, xp)} XP`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between">
        <span className="text-[11px] text-muted-foreground">Level {level}</span>
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <motion.div className="h-full rounded-full"
          style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--primary-glow)))" }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={springSoft} />
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, sub, action, actionLabel }: {
  icon:ReactNode; title:string; sub?:string; action?: () => void; actionLabel?: string;
}) {
  return (
    <motion.div className="flex flex-col items-center gap-3 py-12 text-center"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT }}
    >
      <motion.div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center text-muted-foreground border border-border/50 shadow-sm"
        initial={{ scale: 0.7, opacity: 0, rotate: -5 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ ...springSnappy, delay: 0.05 }}
      >{icon}</motion.div>
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        className="text-sm font-semibold text-foreground"
      >{title}</motion.div>
      {sub && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.3 }}
          className="text-xs text-muted-foreground/70 max-w-xs"
        >{sub}</motion.div>
      )}
      {action && actionLabel && (
        <motion.button
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.3 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={action}
          className="mt-2 text-xs font-semibold text-primary hover:text-primary/80 px-4 py-2 rounded-xl border border-primary/20 bg-primary/5 transition-colors"
        >{actionLabel}</motion.button>
      )}
    </motion.div>
  );
}

export function Chip({ children, color = "var(--muted-foreground)" }: { children:ReactNode; color?:string }) {
  return (
    <motion.span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full border"
      style={{ color: `hsl(${color})`, borderColor: `hsl(${color} / 0.3)`, background: `hsl(${color} / 0.1)` }}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={springSnappy}
    >
      {children}
    </motion.span>
  );
}

// CHUNK 10.7 — `null` added: student_mistakes.difficulty is nullable, and a
// mistake whose difficulty was never recorded is a real state.
export function DifficultyBadge({ level }: { level:"easy"|"medium"|"hard"|string|undefined|null }) {
  if (!level) return null;
  const map: Record<string, string> = {
    easy: "var(--success)",
    medium: "var(--warning)",
    hard: "var(--destructive)",
  };
  const colorVar = map[level] ?? "var(--muted-foreground)";
  return <Chip color={colorVar}>{level.charAt(0).toUpperCase() + level.slice(1)}</Chip>;
}

export const subjectColor: Record<string, string> = {
  Mathematics: "var(--color-math)",
  Physics: "var(--color-physics)",
  Chemistry: "var(--color-chemistry)",
  Biology: "var(--color-biology)",
  English: "var(--color-english)",
  Accountancy: "var(--color-biology)",
  "Business Studies": "var(--color-chemistry)",
  Economics: "var(--color-english)",
  Hindi: "var(--color-hindi)",
  Science: "var(--color-physics)",
  "Social Science": "var(--color-social)",
};

// Premium hover card with glow effect
export function HoverCard({ children, className, color = "var(--primary)", onClick }: {
  children: ReactNode; className?: string; color?: string; onClick?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      onClick={onClick}
      className={cn(
        "rounded-2xl border border-border/70 bg-card/95 p-4 cursor-pointer transition-shadow",
        className
      )}
      initial={reduceMotion ? undefined : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={reduceMotion ? undefined : {
        y: -3,
        boxShadow: `0 8px 25px -5px hsl(${color} / 0.15), 0 0 0 1px hsl(${color} / 0.12)`,
        borderColor: `hsl(${color} / 0.3)`,
      }}
      whileTap={reduceMotion ? undefined : { scale: 0.985, y: -1 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
    >{children}</motion.div>
  );
}

// Animated icon wrapper
export function AnimatedIcon({ icon, color = "var(--primary)", size = "md", pulse = false }: {
  icon: ReactNode; color?: string; size?: "sm" | "md" | "lg"; pulse?: boolean;
}) {
  const sizes = { sm: "w-8 h-8", md: "w-10 h-10", lg: "w-12 h-12" };
  return (
    <motion.div
      className={cn(
        "rounded-xl flex items-center justify-center shrink-0",
        sizes[size],
        pulse && "animate-pulse"
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${color} / 0.15), hsl(${color} / 0.05))`,
        border: `1px solid hsl(${color} / 0.2)`,
        color: `hsl(${color})`,
      }}
      whileHover={{ scale: 1.08, rotate: 3 }}
      transition={springSnappy}
    >
      {icon}
    </motion.div>
  );
}

// Animated badge/tag with icon
export function TagWithIcon({ icon, label, color = "var(--muted-foreground)", onClick }: {
  icon: ReactNode; label: string; color?: string; onClick?: () => void;
}) {
  return (
    <motion.span
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full border",
        onClick && "cursor-pointer"
      )}
      style={{
        color: `hsl(${color})`,
        borderColor: `hsl(${color} / 0.25)`,
        background: `hsl(${color} / 0.08)`,
      }}
      whileHover={onClick ? { scale: 1.03, background: `hsl(${color} / 0.12)` } : undefined}
      whileTap={onClick ? { scale: 0.97 } : undefined}
      transition={springSnappy}
    >
      {icon}
      {label}
    </motion.span>
  );
}

// Shimmer loading skeleton
export function Skeleton({ className, animate = true }: { className?: string; animate?: boolean }) {
  return (
    <div className={cn(
      "bg-gradient-to-r from-muted via-muted/60 to-muted rounded-lg",
      animate && "animate-pulse",
      className
    )} />
  );
}

// List item with hover animation
export function ListItem({ icon, title, subtitle, value, valueColor, onClick, className }: {
  icon: ReactNode; title: string; subtitle?: string; value?: string | number;
  valueColor?: string; onClick?: () => void; className?: string;
}) {
  return (
    <motion.div
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 p-3 rounded-xl border border-border/70 bg-card/50",
        onClick && "cursor-pointer hover:border-border hover:bg-muted/50",
        className
      )}
      whileHover={onClick ? { x: 4, borderColor: "hsl(var(--primary) / 0.3)" } : undefined}
      whileTap={onClick ? { scale: 0.99 } : undefined}
      transition={{ duration: 0.15, ease: EASE_OUT }}
    >
      <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">{title}</div>
        {subtitle && <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>}
      </div>
      {value !== undefined && (
        <div className="text-sm font-bold tabular-nums shrink-0" style={{ color: valueColor || "hsl(var(--foreground))" }}>
          {value}
        </div>
      )}
    </motion.div>
  );
}

// Premium page header with animated elements
export function PageHeader({ title, subtitle, badge, icon, action }: {
  title: string; subtitle?: string; badge?: string; icon?: ReactNode; action?: ReactNode;
}) {
  return (
    <motion.div
      className="flex items-start gap-4 mb-6"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
    >
      {icon && (
        <motion.div
          className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 flex items-center justify-center text-primary shrink-0"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, ...springSnappy }}
        >
          {icon}
        </motion.div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-black text-foreground" style={{ fontFamily: "var(--font-display)" }}>
            {title}
          </h1>
          {badge && (
            <motion.span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, ...springSnappy }}
            >
              {badge}
            </motion.span>
          )}
        </div>
        {subtitle && (
          <motion.p
            className="text-sm text-muted-foreground mt-1"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.3 }}
          >
            {subtitle}
          </motion.p>
        )}
      </div>
      {action && (
        <motion.div
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2, duration: 0.3 }}
        >
          {action}
        </motion.div>
      )}
    </motion.div>
  );
}