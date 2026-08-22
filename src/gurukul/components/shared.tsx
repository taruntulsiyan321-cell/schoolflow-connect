import type { ReactNode } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { motion, AnimatePresence, useReducedMotion, type Variants } from "framer-motion";
import { progressionLevelProgress } from "@/academic/services/progressionMath";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Shared motion language for the whole app â€” every animated primitive below
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

export function GlassCard({ children, className, glow, onClick }: {
  children: ReactNode; className?: string;
  glow?: "blue"|"cyan"|"amber"|"purple"|"green"|"rose";
  onClick?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const glows: Record<string, string> = {
    blue:   "border-[#3b5bdb]/20",
    cyan:   "border-[#4b9fd4]/20",
    amber:  "border-[#c08a3a]/20",
    purple: "border-[#6882e8]/20",
    green:  "border-[#4aa87a]/20",
    rose:   "border-[#cc5069]/20",
  };
  return (
    <motion.div
      onClick={onClick}
      className={cn(
        "rounded-2xl border bg-surface/90 backdrop-blur-sm",
        glow ? glows[glow] : "border-border/70",
        onClick && "cursor-pointer",
        className
      )}
      initial={reduceMotion ? undefined : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
      whileHover={onClick && !reduceMotion ? { y: -3, borderColor: "rgba(255,255,255,0.15)" } : undefined}
      whileTap={onClick && !reduceMotion ? { scale: 0.985, y: -1 } : undefined}
    >{children}</motion.div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 mb-4", className)}>
      <div className="w-1 h-4 rounded-full bg-[#3b5bdb]" />
      <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{children}</span>
    </div>
  );
}

import { displaySubject } from "@/lib/academicPresentation";

const SUBJECT_COLORS: Record<string,string> = {
  Mathematics:"#3b5bdb", Physics:"#4b9fd4", Chemistry:"#6882e8",
  Biology:"#4aa87a", English:"#c08a3a", Accountancy:"#4aa87a",
  "Business Studies":"#6882e8", Economics:"#c08a3a", Hindi:"#cc5069",
};

export function SubjectBadge({ subject, color }: { subject: string; color?: string }) {
  const label = displaySubject(subject);
  if (!label) return null;
  const c = color ?? SUBJECT_COLORS[label] ?? SUBJECT_COLORS[subject] ?? "#78788c";
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
      style={{ color:c, borderColor:`${c}30`, background:`${c}12` }}>
      {label}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string,{label:string;color:string;bg:string}> = {
    "in-recovery": {label:"In Recovery",  color:"#c08a3a",bg:"#c08a3a15"},
    "mastered":    {label:"Mastered",     color:"#4aa87a",bg:"#4aa87a15"},
    "pending":     {label:"Pending",      color:"#cc5069",bg:"#cc506915"},
    "active":      {label:"Active",       color:"#4b9fd4",bg:"#4b9fd415"},
    "won":         {label:"Won",          color:"#4aa87a",bg:"#4aa87a15"},
    "lost":        {label:"Lost",         color:"#cc5069",bg:"#cc506915"},
    "answered":    {label:"Answered",     color:"#4aa87a",bg:"#4aa87a15"},
    "submitted":   {label:"Submitted",    color:"#3b5bdb",bg:"#3b5bdb15"},
    "graded":      {label:"Graded",       color:"#6882e8",bg:"#6882e815"},
    "in-progress": {label:"In Progress",  color:"#c08a3a",bg:"#c08a3a15"},
    "not-started": {label:"Not Started",  color:"#78788c",bg:"#78788c15"},
  };
  const s = map[status] ?? {label:status,color:"#78788c",bg:"#78788c15"};
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{color:s.color,background:s.bg}}>{s.label}</span>;
}

export function Avatar({ initials, color, size="md" }: { initials:string; color?:string; size?:"sm"|"md"|"lg" }) {
  const sizes = {sm:"w-7 h-7 text-[10px]", md:"w-9 h-9 text-xs", lg:"w-12 h-12 text-sm"};
  return (
    <motion.div className={cn("rounded-full flex items-center justify-center font-black text-white shrink-0", sizes[size])}
      style={{background: color ? `linear-gradient(135deg,${color},${color}99)` : "linear-gradient(135deg,#3b5bdb,#6882e8)"}}
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
  const stroke=7, r=(size-stroke)/2, c=2*Math.PI*r;
  const offset = c - (Math.min(100,Math.max(0,score))/100)*c;
  const col = color ?? (score>=80?"#4b9fd4":score>=60?"#c08a3a":"#cc5069");
  return (
    <div className="relative inline-flex" style={{width:size,height:size}}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke}/>
        <motion.circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={stroke}
          strokeDasharray={c} strokeLinecap="round"
          style={{filter:`drop-shadow(0 0 6px ${col})`}}
          initial={reduceMotion ? undefined : { strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: EASE_OUT }}/>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.span className="font-black tabular-nums" style={{color:col,fontSize:size*0.22}}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.4 }}
        >{score}%</motion.span>
      </div>
    </div>
  );
}

export function ProgressBar({ value, max=100, color="#3b5bdb", height="h-2" }: {
  value:number; max?:number; color?:string; height?:string;
}) {
  const pct = Math.min(100,(value/max)*100);
  return (
    <div className={cn("w-full rounded-full bg-white/5 overflow-hidden", height)}>
      <motion.div className="h-full rounded-full"
        style={{background:color}}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={springSoft}/>
    </div>
  );
}

export function StatTile({ label, value, color, sub }: { label:string; value:string|number; color?:string; sub?:string }) {
  return (
    <motion.div className="bg-white/4 rounded-xl px-3 py-2.5 border border-white/5"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, background: "rgba(255,255,255,0.06)" }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <motion.div
        key={String(value)}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mt-0.5 text-xl font-black tabular-nums" style={{color:color??"#e8eaf0"}}>{value}</motion.div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </motion.div>
  );
}

/** Level progress from ProgressionService â€” mirrors SQL triangular curve when fields omitted. */
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
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <motion.div className="h-full rounded-full"
          style={{background:"linear-gradient(90deg,#3b5bdb,#6882e8)"}}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={springSoft}/>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, sub }: { icon:ReactNode; title:string; sub?:string }) {
  return (
    <motion.div className="flex flex-col items-center gap-3 py-12 text-center"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT }}
    >
      <motion.div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-muted-foreground"
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ...springSnappy, delay: 0.05 }}
      >{icon}</motion.div>
      <div className="text-sm font-semibold text-muted-foreground">{title}</div>
      {sub && <div className="text-xs text-muted-foreground/70">{sub}</div>}
    </motion.div>
  );
}

export function Chip({ children, color }: { children:ReactNode; color?:string }) {
  return (
    <motion.span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full border"
      style={{color:color??"#78788c",borderColor:`${color??"#78788c"}30`,background:`${color??"#78788c"}10`}}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={springSnappy}
    >
      {children}
    </motion.span>
  );
}

export function DifficultyBadge({ level }: { level:"easy"|"medium"|"hard"|string|undefined }) {
  if (!level) return null;
  const map: Record<string,string> = {easy:"#4aa87a",medium:"#c08a3a",hard:"#cc5069"};
  const color = map[level] ?? "#78788c";
  return <Chip color={color}>{level.charAt(0).toUpperCase()+level.slice(1)}</Chip>;
}

export const subjectColor: Record<string,string> = {
  Mathematics:"#3b5bdb", Physics:"#4b9fd4", Chemistry:"#6882e8",
  Biology:"#4aa87a", English:"#c08a3a", Accountancy:"#4aa87a",
  "Business Studies":"#6882e8", Economics:"#c08a3a", Hindi:"#cc5069",
};
