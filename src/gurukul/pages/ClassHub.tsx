import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PageKey } from "@/gurukul/nav";
import { GlassCard, ProgressBar, cn } from "@/gurukul/components/shared";
import {
  Clock, Calendar, CalendarDays, ClipboardList, FlaskConical,
  MessageCircle, Trophy, Medal, ArrowRight, Library, Loader2,
  Bell, MessageSquare,
} from "lucide-react";
import {
  AcademicProfileService,
  AnalyticsService,
  HomeworkService,
  useAcademicLive,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import { toast } from "@/hooks/use-toast";

type Props = { setPage: (p: PageKey) => void };

type HubTile =
  | {
      kind: "page";
      key: PageKey;
      label: string;
      sub: string;
      icon: React.ReactNode;
      color: string;
      badge: string;
    }
  | {
      kind: "path";
      path: string;
      label: string;
      sub: string;
      icon: React.ReactNode;
      color: string;
      badge: string;
    };

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
  const navigate = useNavigate();
  const { ctx, ready, studentId } = useAcademicContext();
  const liveVersion = useAcademicLive(["attendance", "homework", "profile", "examination"]);
  const [attPct, setAttPct] = useState(0);
  const [examAvg, setExamAvg] = useState(0);
  const [hwPending, setHwPending] = useState(0);
  const [hwTotal, setHwTotal] = useState(0);
  const [hwPct, setHwPct] = useState(0);
  const [loading, setLoading] = useState(true);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate();

  useEffect(() => {
    if (!ready || !ctx || !studentId) {
      setAttPct(0);
      setExamAvg(0);
      setHwPending(0);
      setHwTotal(0);
      setHwPct(0);
      endLoading(setLoading);
      return;
    }
    let cancelled = false;
    (async () => {
      beginLoading(setLoading);
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
        if (settled.every((s) => s.status === "rejected")) {
          toast({
            title: "Could not load class stats",
            description: "Showing zeros until Academic Engine responds.",
            variant: "destructive",
          });
        }
      } catch (e) {
        if (!cancelled) {
          setAttPct(0);
          setExamAvg(0);
          setHwPending(0);
          setHwTotal(0);
          setHwPct(0);
          toast({
            title: "Could not load class stats",
            description: e instanceof Error ? e.message : "Unknown error",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) endLoading(setLoading);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, studentId, liveVersion]);

  const features: HubTile[] = [
    {
      kind: "page",
      key: "timetable",
      label: "Timetable",
      sub: "Daily class schedule with periods, teachers & rooms",
      icon: <Clock className="w-6 h-6" />,
      color: "#3b5bdb",
      badge: "Schedule",
    },
    {
      kind: "page",
      key: "calendar",
      label: "Calendar",
      sub: "Tests, exams, events and submission deadlines",
      icon: <Calendar className="w-6 h-6" />,
      color: "#4b9fd4",
      badge: "Events",
    },
    {
      kind: "page",
      key: "attendance",
      label: "Attendance",
      sub: "Track your presence via Academic Engine",
      icon: <CalendarDays className="w-6 h-6" />,
      color: "#4aa87a",
      badge: `${attPct}% overall`,
    },
    {
      kind: "page",
      key: "assignments",
      label: "Homework",
      sub: "Assignments from HomeworkService",
      icon: <ClipboardList className="w-6 h-6" />,
      color: "#c08a3a",
      badge: `${hwPending} pending`,
    },
    {
      kind: "page",
      key: "tests",
      label: "Tests",
      sub: "Exam averages from AnalyticsService",
      icon: <FlaskConical className="w-6 h-6" />,
      color: "#6882e8",
      badge: `${examAvg}% exam avg`,
    },
    {
      kind: "page",
      key: "doubtportal",
      label: "Doubts",
      sub: "Ask questions, get teacher answers",
      icon: <MessageCircle className="w-6 h-6" />,
      color: "#cc5069",
      badge: "Open portal",
    },
    {
      kind: "path",
      path: "/student/notices",
      label: "Notices",
      sub: "School and class announcements",
      icon: <Bell className="w-6 h-6" />,
      color: "#6882e8",
      badge: "Announcements",
    },
    {
      kind: "path",
      path: "/student/chat",
      label: "Messages",
      sub: "Direct messages with teachers",
      icon: <MessageSquare className="w-6 h-6" />,
      color: "#4aa87a",
      badge: "Inbox",
    },
    {
      kind: "page",
      key: "leaderboard",
      label: "Rankings",
      sub: "Class XP from Progression Engine",
      icon: <Trophy className="w-6 h-6" />,
      color: "#c08a3a",
      badge: "Live rankings",
    },
    {
      kind: "page",
      key: "achievements",
      label: "Achievements",
      sub: "Milestones unlocked through learning",
      icon: <Medal className="w-6 h-6" />,
      color: "#c08a3a",
      badge: "View",
    },
    {
      kind: "page",
      key: "resources",
      label: "Resources",
      sub: "Notes, PDFs and videos shared by your teachers",
      icon: <Library className="w-6 h-6" />,
      color: "#4b9fd4",
      badge: "Library",
    },
  ];

  if (showLoading(loading)) {
    return (
      <div className="flex items-center justify-center py-20 text-[#78788c] text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading class hub…
      </div>
    );
  }

  if (ready && !studentId) {
    return (
      <div className="text-center text-sm text-[#78788c] py-16">
        No student profile linked to this account.
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
            key={f.kind === "page" ? `${f.key}-${f.label}` : f.path}
            onClick={() => (f.kind === "page" ? setPage(f.key) : navigate(f.path))}
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
