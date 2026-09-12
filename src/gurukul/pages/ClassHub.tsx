import { useEffect, useState } from "react";
import { withAlpha } from "@/lib/colorAlpha";
import { useNavigate } from "react-router-dom";
import type { PageKey } from "@/gurukul/nav";
import { GlassCard, NoStudentProfile, PageHeader, PageSkeleton, Skeleton, SkeletonCard, SkeletonStats } from "@/gurukul/components/shared";
import {
  Clock, Calendar, CalendarDays, ClipboardList, FlaskConical,
  MessageCircle, Trophy, ArrowRight, Library, Bell, MessageSquare
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
    // STILL RESOLVING IS NOT LOADED.
    //
    // This branch used to include `!ready`, and `endLoading` both sets
    // `loadedRef` and drops `loading` to false. So while the academic context
    // was still resolving, the screen declared itself finished and painted its
    // entire layout with zeros — "Attendance 0%", "Exam avg 0%". Then
    // `studentId` arrived, the gate's identity key changed, the gate reopened,
    // and the skeleton appeared AFTER the content.
    //
    // Measured before this fix: /student/class went 794 chars of content →
    // 182 (loading) → 838, with the zeroed content on screen for ~750ms.
    // Content, then a loading state, then content is the most jarring sequence
    // there is, and it is precisely what skeletons exist to prevent — swapping
    // the spinner for a skeleton without fixing this would have made a
    // better-looking flash.
    //
    // `ready` false means "wait", and waiting is what the loading state is for.
    // Only `ready` WITH no student is genuinely settled, and that is the state
    // NoStudentProfile renders.
    if (!ready) return;
    if (!ctx || !studentId) {
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
      color: "hsl(var(--primary))",
      badge: "Schedule",
    },
    {
      kind: "page",
      key: "calendar",
      label: "Calendar",
      sub: "Tests, exams, events and submission deadlines",
      icon: <Calendar className="w-6 h-6" />,
      color: "hsl(var(--info))",
      badge: "Events",
    },
    {
      kind: "page",
      key: "attendance",
      label: "Attendance",
      sub: "Your day-by-day attendance record",
      icon: <CalendarDays className="w-6 h-6" />,
      color: "hsl(var(--success))",
      badge: `${attPct}% overall`,
    },
    {
      kind: "page",
      key: "assignments",
      label: "Homework",
      sub: "Homework your teachers have set",
      icon: <ClipboardList className="w-6 h-6" />,
      color: "hsl(var(--warning))",
      badge: `${hwPending} pending`,
    },
    {
      kind: "page",
      key: "tests",
      label: "Tests",
      sub: "Your marks from class tests and exams",
      icon: <FlaskConical className="w-6 h-6" />,
      color: "hsl(var(--primary))",
      badge: `${examAvg}% exam avg`,
    },
    {
      kind: "page",
      key: "doubtportal",
      label: "Doubts",
      sub: "Ask questions, get teacher answers",
      icon: <MessageCircle className="w-6 h-6" />,
      color: "hsl(var(--destructive))",
      badge: "Open portal",
    },
    {
      kind: "path",
      path: "/student/notices",
      label: "Notices",
      sub: "School and class announcements",
      icon: <Bell className="w-6 h-6" />,
      color: "hsl(var(--primary))",
      badge: "Announcements",
    },
    {
      kind: "path",
      path: "/student/chat",
      label: "Messages",
      sub: "Direct messages with teachers",
      icon: <MessageSquare className="w-6 h-6" />,
      color: "hsl(var(--success))",
      badge: "Inbox",
    },
    {
      kind: "page",
      key: "leaderboard",
      label: "Rankings",
      sub: "Where you stand in your class",
      icon: <Trophy className="w-6 h-6" />,
      color: "hsl(var(--warning))",
      badge: "Live rankings",
    },
    {
      kind: "page",
      key: "resources",
      label: "Resources",
      sub: "Notes, PDFs and videos shared by your teachers",
      icon: <Library className="w-6 h-6" />,
      color: "hsl(var(--info))",
      badge: "Library",
    },
  ];

  // The title needs no network, so it no longer waits for one.
  const header = (
    <PageHeader
      title="Class"
      subtitle="Your attendance, homework and marks, and everything your class shares."
    />
  );

  // `!ready` here as well as in the effect: the effect is what stops the gate
  // being marked loaded too early, this is what keeps the very first commit —
  // before any effect has run — out of the content branch.
  if (!ready || showLoading(loading)) {
    return (
      <div className="space-y-8">
        {header}
        <PageSkeleton label="Loading class hub" className="space-y-8">
          <SkeletonStats count={4} />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} className="p-5 space-y-3">
                <Skeleton className="w-10 h-10 rounded-xl" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-full" />
              </SkeletonCard>
            ))}
          </div>
        </PageSkeleton>
      </div>
    );
  }

  if (ready && !studentId) {
    return <div className="space-y-8">{header}<NoStudentProfile /></div>;
  }

  return (
    <div className="space-y-8">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Attendance", value: `${attPct}%`, color: "hsl(var(--success))" },
          { label: "Exam avg", value: `${examAvg}%`, color: "hsl(var(--primary))" },
          { label: "Pending HW", value: hwPending, color: "hsl(var(--warning))" },
          { label: "HW completion", value: `${hwPct}%`, color: "hsl(var(--info))" },
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
                style={{ background: `${withAlpha(f.color, 0.08)}`, color: f.color }}
              >
                {f.icon}
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-all mt-0.5" />
            </div>
            <div className="text-sm font-black text-foreground mb-1">{f.label}</div>
            <div className="text-[11px] text-muted-foreground leading-relaxed mb-3">{f.sub}</div>
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold"
              style={{ color: f.color, background: `${withAlpha(f.color, 0.07)}`, border: `1px solid ${withAlpha(f.color, 0.15)}` }}
            >
              {f.badge}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
