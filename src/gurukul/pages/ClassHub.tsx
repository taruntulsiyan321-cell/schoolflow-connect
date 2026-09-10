import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PageKey } from "@/gurukul/nav";
import { GlassCard, cn } from "@/gurukul/components/shared";
import {
  Clock, Calendar, CalendarDays, ClipboardList, FlaskConical,
  MessageCircle, Trophy, ArrowRight, Library, Loader2,
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
import { toErrorMessage } from "@/lib/presentation";

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
  const [hwPct, setHwPct] = useState(0);
  const [loading, setLoading] = useState(true);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate([studentId]);

  useEffect(() => {
    if (!ready || !ctx || !studentId) {
      setAttPct(0);
      setExamAvg(0);
      setHwPending(0);
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
        // The disputed figure, settled: this counts the student's OWN homework
        // rows with no submission, or one still pending or returned. The bottom
        // widget said "0 / 10 pending", which was the same number phrased as a
        // ratio against every homework ever set — arithmetically fine, and it
        // read as a different claim. The widget is gone; this is the figure.
        setHwPending(
          hw.filter((r) => !r.submission || ["pending", "returned"].includes(r.submission.status)).length,
        );
        if (settled.every((s) => s.status === "rejected")) {
          toast({
            title: "Could not load class stats",
            description: "Showing zeros until your class data loads.",
            variant: "destructive",
          });
        }
      } catch (e) {
        if (!cancelled) {
          setAttPct(0);
          setExamAvg(0);
          setHwPending(0);
          setHwPct(0);
          toast({
            title: "Could not load class stats",
            description: toErrorMessage(e, "Unknown error"),
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
      sub: "Your day-by-day attendance record",
      icon: <CalendarDays className="w-6 h-6" />,
      color: "#4aa87a",
      badge: `${attPct}% overall`,
    },
    {
      kind: "page",
      key: "assignments",
      label: "Homework",
      sub: "Homework your teachers have set",
      icon: <ClipboardList className="w-6 h-6" />,
      color: "#c08a3a",
      badge: `${hwPending} pending`,
    },
    {
      kind: "page",
      key: "tests",
      label: "Tests",
      sub: "Your marks from class tests and exams",
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
      sub: "Where you stand in your class",
      icon: <Trophy className="w-6 h-6" />,
      color: "#c08a3a",
      badge: "Live rankings",
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
      <div className="flex items-center justify-center py-20 text-muted-foreground text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading class hub…
      </div>
    );
  }

  if (ready && !studentId) {
    return (
      <div className="text-center text-sm text-muted-foreground py-16">
        No student profile linked to this account.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">Student Panel</div>
        <h1 className="text-3xl font-black text-foreground" style={{ fontFamily: "var(--font-display)" }}>
          Class
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Your attendance, homework and marks, and everything your class shares.
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
            <div className="text-[11px] text-muted-foreground mt-0.5">{s.label}</div>
          </GlassCard>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {features.map((f) => (
          <button
            key={f.kind === "page" ? `${f.key}-${f.label}` : f.path}
            onClick={() => (f.kind === "page" ? setPage(f.key) : navigate(f.path))}
            className="group text-left p-5 rounded-2xl border border-border/70 bg-surface/90 transition-all duration-200 hover:border-border hover:scale-[1.02]"
          >
            <div className="flex items-start justify-between mb-4">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                style={{ background: `${f.color}15`, color: f.color }}
              >
                {f.icon}
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-all mt-0.5" />
            </div>
            <div className="text-sm font-black text-foreground mb-1">{f.label}</div>
            <div className="text-[11px] text-muted-foreground leading-relaxed mb-3">{f.sub}</div>
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold"
              style={{ color: f.color, background: `${f.color}12`, border: `1px solid ${f.color}25` }}
            >
              {f.badge}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
