import { useEffect, useState } from "react";
import type { PageKey } from "@/gurukul/nav";
import { GlassCard, ProgressBar, cn } from "@/gurukul/components/shared";
import {
  Clock, Calendar, CalendarDays, ClipboardList, FlaskConical,
  MessageCircle, Trophy, Medal, ArrowRight, Library, Loader2,
} from "lucide-react";
import {
  AcademicProfileService,
  AnalyticsService,
  HomeworkService,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";

type Props = { setPage: (p: PageKey) => void };

function MiniRing({ pct, color }: { pct: number; color: string }) {
  const size = 52;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-black tabular-nums" style={{ color }}>
          {pct}%
        </span>
      </div>
    </div>
  );
}

/**
 * Class Hub — Academic Engine for attendance / homework / exams / tests.
 * Navigation chrome only for non-academic modules (timetable, resources, etc.).
 */
export default function ClassHub({ setPage }: Props) {
  const { ctx, ready, studentId } = useAcademicContext();
  const [attPct, setAttPct] = useState(0);
  const [examAvg, setExamAvg] = useState(0);
  const [hwPending, setHwPending] = useState(0);
  const [hwTotal, setHwTotal] = useState(0);
  const [hwPct, setHwPct] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !ctx || !studentId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const settled = await Promise.allSettled([
          AcademicProfileService.get(ctx, studentId),
          AnalyticsService.forStudent(ctx, studentId),
          HomeworkService.listForStudent(ctx, studentId),
        ]);
        if (cancelled) return;
        const profile = settled[0].status === "fulfilled" ? settled[0].value : null;
        const analytics = settled[1].status === "fulfilled" ? settled[1].value : null;
        const hw = settled[2].status === "fulfilled" ? settled[2].value : [];
        setAttPct(Math.round(profile?.attendancePct ?? analytics?.attendance.pct ?? 0));
        setExamAvg(Math.round(analytics?.exams.averagePct ?? 0));
        setHwPct(Math.round(analytics?.homework.pct ?? 0));
        setHwTotal(hw.length);
        setHwPending(
          hw.filter((r) => !r.submission || ["pending", "returned"].includes(r.submission.status)).length,
        );
      } catch {
        /* empty engine state is fine */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, studentId]);

  const features: {
    key: PageKey;
    label: string;
    sub: string;
    icon: React.ReactNode;
    color: string;
    badge: string;
  }[] = [
    {
      key: "timetable",
      label: "Timetable",
      sub: "Daily class schedule with periods, teachers & rooms",
      icon: <Clock className="w-6 h-6" />,
      color: "#3b5bdb",
      badge: "Schedule",
    },
    {
      key: "calendar",
      label: "Calendar",
      sub: "Tests, exams, events and submission deadlines",
      icon: <Calendar className="w-6 h-6" />,
      color: "#4b9fd4",
      badge: "Events",
    },
    {
      key: "attendance",
      label: "Attendance",
      sub: "Track your presence via Academic Engine",
      icon: <CalendarDays className="w-6 h-6" />,
      color: "#4aa87a",
      badge: `${attPct}% overall`,
    },
    {
      key: "assignments",
      label: "Homework",
      sub: "Assignments from HomeworkService",
      icon: <ClipboardList className="w-6 h-6" />,
      color: "#c08a3a",
      badge: `${hwPending} pending`,
    },
    {
      key: "tests",
      label: "Tests",
      sub: "Exam averages from AnalyticsService",
      icon: <FlaskConical className="w-6 h-6" />,
      color: "#6882e8",
      badge: `${examAvg}% exam avg`,
    },
    {
      key: "doubtportal",
      label: "Doubts",
      sub: "Ask questions, get teacher answers",
      icon: <MessageCircle className="w-6 h-6" />,
      color: "#cc5069",
      badge: "Open portal",
    },
    {
      key: "leaderboard",
      label: "Rankings",
      sub: "Class standing from academic profiles",
      icon: <Trophy className="w-6 h-6" />,
      color: "#c08a3a",
      badge: "Live rankings",
    },
    {
      key: "achievements",
      label: "Achievements",
      sub: "Milestones unlocked through learning",
      icon: <Medal className="w-6 h-6" />,
      color: "#c08a3a",
      badge: "View",
    },
    {
      key: "resources",
      label: "Resources",
      sub: "Notes, PDFs and videos shared by your teachers",
      icon: <Library className="w-6 h-6" />,
      color: "#4b9fd4",
      badge: "Library",
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[#78788c] text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading class hub…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-[#78788c] mb-1">Student Panel</div>
        <h1 className="text-3xl font-black text-white" style={{ fontFamily: "var(--font-display)" }}>
          Class
        </h1>
        <p className="text-[#78788c] text-sm mt-1">
          Academic stats from the Academic Engine — schedule & resources are navigation only.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Attendance", value: `${attPct}%`, color: "#4aa87a" },
          { label: "Exam avg", value: `${examAvg}%`, color: "#6882e8" },
          { label: "Pending HW", value: hwPending, color: "#c08a3a" },
          { label: "HW completion", value: `${hwPct}%`, color: "#4b9fd4" },
        ].map((s) => (
          <GlassCard key={s.label} className="p-4 text-center">
            <div className="text-2xl font-black tabular-nums" style={{ color: s.color }}>
              {s.value}
            </div>
            <div className="text-[11px] text-[#78788c] mt-0.5">{s.label}</div>
          </GlassCard>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {features.map((f) => (
          <button
            key={`${f.key}-${f.label}`}
            onClick={() => setPage(f.key)}
            className="group text-left p-5 rounded-2xl border border-white/7 bg-[#131316]/90 transition-all duration-200 hover:border-white/20 hover:scale-[1.02]"
          >
            <div className="flex items-start justify-between mb-4">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                style={{ background: `${f.color}15`, color: f.color }}
              >
                {f.icon}
              </div>
              <ArrowRight className="w-4 h-4 text-[#78788c] group-hover:text-white transition-all mt-0.5" />
            </div>
            <div className="text-sm font-black text-white mb-1">{f.label}</div>
            <div className="text-[11px] text-[#78788c] leading-relaxed mb-3">{f.sub}</div>
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold"
              style={{ color: f.color, background: `${f.color}12`, border: `1px solid ${f.color}25` }}
            >
              {f.badge}
            </div>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-[#4aa87a]" />
            <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Attendance</span>
            <button
              onClick={() => setPage("attendance")}
              className="ml-auto text-[10px] text-[#3b5bdb] hover:text-[#a5b4fc] transition-colors"
            >
              View →
            </button>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <MiniRing pct={attPct} color="#4aa87a" />
            <div>
              <div className="text-xl font-black text-white">{attPct}%</div>
              <div className="text-[11px] text-[#78788c]">AcademicProfileService</div>
            </div>
          </div>
          <ProgressBar value={attPct} color="#4aa87a" height="h-1.5" />
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-[#c08a3a]" />
            <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Homework</span>
            <button
              onClick={() => setPage("assignments")}
              className="ml-auto text-[10px] text-[#3b5bdb] hover:text-[#a5b4fc] transition-colors"
            >
              View →
            </button>
          </div>
          <div className={cn("text-xl font-black text-white mb-1")}>
            {hwPending} / {hwTotal} pending
          </div>
          <div className="text-[11px] text-[#78788c] mb-3">HomeworkService · {hwPct}% completion</div>
          <ProgressBar value={hwPct} color="#c08a3a" height="h-1.5" />
        </GlassCard>
      </div>
    </div>
  );
}
