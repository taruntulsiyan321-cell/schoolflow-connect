import type { PageKey } from "@/gurukul/data/mock";
import { student, attendanceData, assignments, doubts, tests, achievements, leaderboard, resources } from "@/gurukul/data/mock";
import { GlassCard, ProgressBar, cn } from "@/gurukul/components/shared";
import {
  Clock, Calendar, CalendarDays, ClipboardList, FlaskConical,
  MessageCircle, Trophy, Medal, ArrowRight, CheckCircle2, Library,
} from "lucide-react";

type Props = { setPage: (p: PageKey) => void };

const FEATURES = [
  {
    key:      "timetable"   as PageKey,
    label:    "Timetable",
    sub:      "Daily class schedule with periods, teachers & rooms",
    icon:     <Clock className="w-6 h-6"/>,
    color:    "#3b5bdb",
    badge:    "Today: 6 periods",
  },
  {
    key:      "calendar"    as PageKey,
    label:    "Calendar",
    sub:      "Tests, exams, events and submission deadlines",
    icon:     <Calendar className="w-6 h-6"/>,
    color:    "#4b9fd4",
    badge:    "4 events this month",
  },
  {
    key:      "attendance"  as PageKey,
    label:    "Attendance",
    sub:      "Track your presence across all subjects",
    icon:     <CalendarDays className="w-6 h-6"/>,
    color:    "#4aa87a",
    badge:    `${attendanceData.overall}% overall`,
  },
  {
    key:      "assignments" as PageKey,
    label:    "Homework",
    sub:      "Assignments given by your teachers",
    icon:     <ClipboardList className="w-6 h-6"/>,
    color:    "#c08a3a",
    badge:    `${assignments.filter(a=>a.status==="not-started").length} pending`,
  },
  {
    key:      "tests"       as PageKey,
    label:    "Tests",
    sub:      "Your test scores, rank & upcoming exams",
    icon:     <FlaskConical className="w-6 h-6"/>,
    color:    "#6882e8",
    badge:    `${tests.filter(t=>t.status==="upcoming").length} upcoming`,
  },
  {
    key:      "doubtportal" as PageKey,
    label:    "Doubts",
    sub:      "Ask questions, get teacher answers",
    icon:     <MessageCircle className="w-6 h-6"/>,
    color:    "#cc5069",
    badge:    `${doubts.filter(d=>d.status==="answered").length} answered`,
  },
  {
    key:      "leaderboard" as PageKey,
    label:    "Rankings",
    sub:      "See where you stand among classmates",
    icon:     <Trophy className="w-6 h-6"/>,
    color:    "#c08a3a",
    badge:    `You are #${student.rank}`,
  },
  {
    key:      "achievements" as PageKey,
    label:    "Achievements",
    sub:      "Milestones you have unlocked through learning",
    icon:     <Medal className="w-6 h-6"/>,
    color:    "#c08a3a",
    badge:    `${achievements.filter(a=>a.unlocked).length} unlocked`,
  },
  {
    key:      "resources"    as PageKey,
    label:    "Resources",
    sub:      "Notes, PDFs and videos shared by your teachers",
    icon:     <Library className="w-6 h-6"/>,
    color:    "#4b9fd4",
    badge:    `${resources.length} files available`,
  },
];

function MiniRing({ pct, color }: { pct: number; color: string }) {
  const size = 52, stroke = 5, r = (size-stroke)/2, c = 2*Math.PI*r;
  const offset = c - (pct/100)*c;
  return (
    <div className="relative inline-flex" style={{width:size,height:size}}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{filter:`drop-shadow(0 0 4px ${color}60)`}}/>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-black tabular-nums" style={{color}}>{pct}%</span>
      </div>
    </div>
  );
}

export default function ClassHub({ setPage }: Props) {
  const topStudents   = leaderboard.slice(0, 3);
  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const pendingHW     = assignments.filter(a => a.status === "not-started").length;
  const unanswered    = doubts.filter(d => d.status === "pending").length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-[#78788c] mb-1">Student Panel</div>
        <h1 className="text-3xl font-black text-white" style={{fontFamily:"var(--font-display)"}}>
          Class
        </h1>
        <p className="text-[#78788c] text-sm mt-1">
          Everything about your classroom — schedule, records, performance & more.
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:"Attendance",     value:`${attendanceData.overall}%`, color:"#4aa87a" },
          { label:"Class Rank",     value:`#${student.rank}`,           color:"#c08a3a" },
          { label:"Pending HW",     value:pendingHW,                    color:"#c08a3a" },
          { label:"Doubts Pending", value:unanswered,                   color:"#cc5069" },
        ].map(s => (
          <GlassCard key={s.label} className="p-4 text-center">
            <div className="text-2xl font-black tabular-nums" style={{color:s.color}}>{s.value}</div>
            <div className="text-[11px] text-[#78788c] mt-0.5">{s.label}</div>
          </GlassCard>
        ))}
      </div>

      {/* Feature grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {FEATURES.map(f => (
          <button key={`${f.key}-${f.label}`} onClick={() => setPage(f.key)}
            className="group text-left p-5 rounded-2xl border border-white/7 bg-[#131316]/90 transition-all duration-200 hover:border-white/20 hover:scale-[1.02] hover:shadow-lg">
            <div className="flex items-start justify-between mb-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                style={{background:`${f.color}15`,color:f.color}}>
                {f.icon}
              </div>
              <ArrowRight className="w-4 h-4 text-[#78788c] group-hover:text-white group-hover:translate-x-0.5 transition-all mt-0.5"/>
            </div>
            <div className="text-sm font-black text-white mb-1">{f.label}</div>
            <div className="text-[11px] text-[#78788c] leading-relaxed mb-3">{f.sub}</div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold"
              style={{color:f.color,background:`${f.color}12`,border:`1px solid ${f.color}25`}}>
              {f.badge}
            </div>
          </button>
        ))}
      </div>

      {/* Bottom row: attendance bars + leaderboard snapshot + achievements */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Attendance by subject */}
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-[#4aa87a]"/>
            <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Attendance</span>
            <button onClick={() => setPage("attendance")} className="ml-auto text-[10px] text-[#3b5bdb] hover:text-[#a5b4fc] transition-colors">View →</button>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <MiniRing pct={attendanceData.overall} color="#4aa87a"/>
            <div>
              <div className="text-xl font-black text-white">{attendanceData.overall}%</div>
              <div className="text-[11px] text-[#78788c]">Overall</div>
            </div>
          </div>
          <div className="space-y-2.5">
            {attendanceData.bySubject.map(s => (
              <div key={s.subject}>
                <div className="flex justify-between mb-1">
                  <span className="text-[11px] text-[#a0aec0]">{s.subject}</span>
                  <span className="text-[11px] font-bold tabular-nums"
                    style={{color:s.pct>=90?"#4aa87a":s.pct>=75?"#c08a3a":"#cc5069"}}>{s.pct}%</span>
                </div>
                <ProgressBar value={s.pct} color={s.pct>=90?"#4aa87a":s.pct>=75?"#c08a3a":"#cc5069"} height="h-1"/>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Class rankings snapshot */}
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-[#c08a3a]"/>
            <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Rankings</span>
            <button onClick={() => setPage("leaderboard")} className="ml-auto text-[10px] text-[#3b5bdb] hover:text-[#a5b4fc] transition-colors">View →</button>
          </div>

          {/* You */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[#3b5bdb]/10 border border-[#3b5bdb]/20 mb-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-white shrink-0"
              style={{background:"linear-gradient(135deg,#3b5bdb,#6882e8)"}}>
              {student.avatar}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white">You · {student.name}</div>
              <div className="text-[10px] text-[#78788c]">{student.xp.toLocaleString()} XP</div>
            </div>
            <div className="text-xl font-black text-[#c08a3a]">#{student.rank}</div>
          </div>

          <div className="space-y-2">
            {topStudents.map((s, i) => (
              <div key={s.rank} className="flex items-center gap-2.5">
                <div className={cn(
                  "w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0",
                  i===0?"bg-amber-400/20 text-amber-400":i===1?"bg-slate-400/20 text-slate-400":"bg-orange-600/20 text-orange-400"
                )}>#{i+1}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{s.name}</div>
                </div>
                <span className="text-[11px] text-[#78788c] tabular-nums">{s.xp.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Achievements snapshot */}
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-amber-400"/>
            <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Achievements</span>
            <button onClick={() => setPage("achievements")} className="ml-auto text-[10px] text-[#3b5bdb] hover:text-[#a5b4fc] transition-colors">View →</button>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center">
              <Medal className="w-6 h-6 text-amber-400"/>
            </div>
            <div>
              <div className="text-xl font-black text-white">{unlockedCount}</div>
              <div className="text-[11px] text-[#78788c]">Unlocked of {achievements.length}</div>
            </div>
          </div>
          <div className="space-y-2.5">
            {achievements.filter(a => a.unlocked).slice(0, 4).map(a => (
              <div key={a.id} className="flex items-center gap-2.5">
                <span className="text-xl shrink-0">{a.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{a.title}</div>
                  <div className="text-[10px] text-[#78788c] truncate">{a.desc}</div>
                </div>
                <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0"/>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
