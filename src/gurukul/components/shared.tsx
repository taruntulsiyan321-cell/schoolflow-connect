import type { ReactNode } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function GlassCard({ children, className, glow, onClick }: {
  children: ReactNode; className?: string;
  glow?: "blue"|"cyan"|"amber"|"purple"|"green"|"rose";
  onClick?: () => void;
}) {
  const glows: Record<string, string> = {
    blue:   "border-[#3b5bdb]/20",
    cyan:   "border-[#4b9fd4]/20",
    amber:  "border-[#c08a3a]/20",
    purple: "border-[#6882e8]/20",
    green:  "border-[#4aa87a]/20",
    rose:   "border-[#cc5069]/20",
  };
  return (
    <div onClick={onClick} className={cn(
      "rounded-2xl border bg-[#131316]/90 backdrop-blur-sm transition-all duration-200",
      glow ? glows[glow] : "border-white/7",
      onClick && "cursor-pointer hover:border-white/15",
      className
    )}>{children}</div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 mb-4", className)}>
      <div className="w-1 h-4 rounded-full bg-[#3b5bdb]" />
      <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">{children}</span>
    </div>
  );
}

const SUBJECT_COLORS: Record<string,string> = {
  Mathematics:"#3b5bdb", Physics:"#4b9fd4", Chemistry:"#6882e8",
  Biology:"#4aa87a", English:"#c08a3a",
};

export function SubjectBadge({ subject, color }: { subject: string; color?: string }) {
  const c = color ?? SUBJECT_COLORS[subject] ?? "#78788c";
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
      style={{ color:c, borderColor:`${c}30`, background:`${c}12` }}>
      {subject}
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
    <div className={cn("rounded-full flex items-center justify-center font-black text-white shrink-0", sizes[size])}
      style={{background: color ? `linear-gradient(135deg,${color},${color}99)` : "linear-gradient(135deg,#3b5bdb,#6882e8)"}}>
      {initials}
    </div>
  );
}

export function ProgressRing({ score, size=80, color }: { score:number; size?:number; color?:string }) {
  const stroke=7, r=(size-stroke)/2, c=2*Math.PI*r;
  const offset = c - (Math.min(100,Math.max(0,score))/100)*c;
  const col = color ?? (score>=80?"#4b9fd4":score>=60?"#c08a3a":"#cc5069");
  return (
    <div className="relative inline-flex" style={{width:size,height:size}}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{filter:`drop-shadow(0 0 6px ${col})`,transition:"stroke-dashoffset 0.9s ease"}}/>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-black tabular-nums" style={{color:col,fontSize:size*0.22}}>{score}%</span>
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
      <div className="h-full rounded-full transition-all duration-700"
        style={{width:`${pct}%`,background:color}}/>
    </div>
  );
}

export function StatTile({ label, value, color, sub }: { label:string; value:string|number; color?:string; sub?:string }) {
  return (
    <div className="bg-white/4 rounded-xl px-3 py-2.5 border border-white/5">
      <div className="text-[10px] uppercase tracking-wider text-[#78788c]">{label}</div>
      <div className="mt-0.5 text-xl font-black tabular-nums" style={{color:color??"#e8eaf0"}}>{value}</div>
      {sub && <div className="text-[10px] text-[#78788c] mt-0.5">{sub}</div>}
    </div>
  );
}

export function XPBar({ xp, level }: { xp:number; level:number }) {
  const progress = (xp%1000)/10;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between">
        <span className="text-[11px] text-[#78788c]">Level {level}</span>
        <span className="text-[11px] text-[#78788c]">{xp%1000}/1000 XP</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full" style={{width:`${progress}%`,background:"linear-gradient(90deg,#3b5bdb,#6882e8)",transition:"width 1s ease"}}/>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, sub }: { icon:ReactNode; title:string; sub?:string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-[#78788c]">{icon}</div>
      <div className="text-sm font-semibold text-[#78788c]">{title}</div>
      {sub && <div className="text-xs text-[#78788c]/70">{sub}</div>}
    </div>
  );
}

export function Chip({ children, color }: { children:ReactNode; color?:string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full border"
      style={{color:color??"#78788c",borderColor:`${color??"#78788c"}30`,background:`${color??"#78788c"}10`}}>
      {children}
    </span>
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
  Biology:"#4aa87a", English:"#c08a3a",
};
