import { useEffect, useState } from "react";
import {
  BookOpen,
  ClipboardList,
  CheckSquare,
  Calendar,
  Users,
  FileText,
  HelpCircle,
  Loader2,
  PenLine,
} from "lucide-react";
import { cn } from "./shared";
import type { TeacherPageKey } from "./nav";
import {
  AttendanceService,
  HomeworkService,
  TestService,
  MarksService,
  DoubtService,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";

function QuickAction({
  icon,
  label,
  color,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-white/7 bg-[#131316] hover:border-white/15 hover:bg-white/3 transition-all group text-center"
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center transition-all group-hover:scale-110"
        style={{ background: `${color}18`, color }}
      >
        {icon}
      </div>
      <div className="text-[10px] font-semibold text-[#78788c] group-hover:text-white transition-all leading-tight">
        {label}
      </div>
    </button>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
  sublabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
  sublabel?: string;
}) {
  return (
    <div className="bg-[#131316] border border-white/7 rounded-2xl p-4 flex items-start gap-3">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${color}18`, color }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xl font-black text-white tabular-nums">{value}</div>
        <div className="text-[10px] text-[#78788c] font-medium mt-0.5">{label}</div>
        {sublabel && <div className="text-[9px] text-[#46465a] mt-0.5">{sublabel}</div>}
      </div>
    </div>
  );
}

function isSameDay(iso: string | null | undefined, day: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return (
    d.getFullYear() === day.getFullYear() &&
    d.getMonth() === day.getMonth() &&
    d.getDate() === day.getDate()
  );
}

function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Teacher home — attention workspace via Academic Engine services (no mocks). */
export default function TeacherHome({ setPage }: { setPage: (p: TeacherPageKey) => void }) {
  const { ctx, ready } = useAcademicContext();
  const [loading, setLoading] = useState(true);
  const [classCount, setClassCount] = useState(0);
  const [classNames, setClassNames] = useState<string[]>([]);
  const [academicWorkAwaitingReview, setAcademicWorkAwaitingReview] = useState(0);
  const [assignmentsAwaitingReview, setAssignmentsAwaitingReview] = useState(0);
  const [testsScheduledToday, setTestsScheduledToday] = useState(0);
  const [upcomingExams, setUpcomingExams] = useState(0);
  const [pendingMarksEntry, setPendingMarksEntry] = useState(0);
  const [doubtsOpen, setDoubtsOpen] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const classes = await AttendanceService.listAssignedClasses(ctx);
        const today = new Date();
        const todayDate = todayIsoDate();
        let awReview = 0;
        let assignReview = 0;
        let testsToday = 0;
        let upcoming = 0;
        let pendingMarks = 0;

        for (const c of classes) {
          const hw = await HomeworkService.listForClassWithStats(ctx, c.id, { limit: 100 });
          for (const h of hw) {
            awReview += h.awaitingReview;
            if ((h.workKind ?? "homework") === "assignment") {
              assignReview += h.awaitingReview;
            }
          }

          const tests = await TestService.listForClass(ctx, c.id);
          for (const t of tests as {
            status?: string;
            created_at?: string;
            scheduled_publish_at?: string | null;
          }[]) {
            const status = t.status ?? "published";
            if (status !== "published" && status !== "scheduled") continue;
            if (
              isSameDay(t.scheduled_publish_at, today) ||
              isSameDay(t.created_at, today)
            ) {
              testsToday += 1;
            }
          }

          const exams = await MarksService.listExamsForClass(ctx, c.id, { limit: 100 });
          for (const e of exams) {
            if (!e.resultsPublishedAt && e.examDate && e.examDate >= todayDate) {
              upcoming += 1;
            }
            if (!e.marksLocked) pendingMarks += 1;
          }
        }

        let open = 0;
        try {
          const doubts = await DoubtService.list(ctx);
          open = (doubts as { status?: string }[]).filter(
            (d) => d.status === "open" || d.status === "pending",
          ).length;
        } catch {
          open = 0;
        }

        if (cancelled) return;
        setClassCount(classes.length);
        setClassNames(classes.map((c) => `${c.name} ${c.section}`.trim()));
        setAcademicWorkAwaitingReview(awReview);
        setAssignmentsAwaitingReview(assignReview);
        setTestsScheduledToday(testsToday);
        setUpcomingExams(upcoming);
        setPendingMarksEntry(pendingMarks);
        setDoubtsOpen(open);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[#78788c] text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading academic dashboard…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#3b5bdb]/10 to-[#f59e0b]/5 border border-[#3b5bdb]/20 rounded-2xl p-5">
        <div className="text-sm font-black text-white">Teacher Dashboard</div>
        <div className="text-xs text-[#78788c] mt-0.5">
          {classCount} assigned class{classCount === 1 ? "" : "es"} today
          {classNames.length > 0 ? ` · ${classNames.slice(0, 4).join(", ")}${classNames.length > 4 ? "…" : ""}` : ""}
        </div>
        {error && <div className="text-xs text-[#cc5069] mt-2">{error}</div>}
      </div>

      <div>
        <div className="text-[10px] font-bold text-[#46465a] uppercase tracking-wider mb-3">
          Quick Actions
        </div>
        <div className="grid grid-cols-4 gap-3">
          <QuickAction
            icon={<Users className="w-5 h-5" />}
            label="Mark Attendance"
            color="#f59e0b"
            onClick={() => setPage("myclasses")}
          />
          <QuickAction
            icon={<BookOpen className="w-5 h-5" />}
            label="Academic Work"
            color="#10b981"
            onClick={() => setPage("myclasses")}
          />
          <QuickAction
            icon={<ClipboardList className="w-5 h-5" />}
            label="Tests"
            color="#6366f1"
            onClick={() => setPage("myclasses")}
          />
          <QuickAction
            icon={<FileText className="w-5 h-5" />}
            label="Exams & Marks"
            color="#3b5bdb"
            onClick={() => setPage("myclasses")}
          />
        </div>
      </div>

      <div>
        <div className="text-[10px] font-bold text-[#46465a] uppercase tracking-wider mb-3">
          Needs attention
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard
            icon={<BookOpen className="w-5 h-5" />}
            label="Academic Work pending review"
            value={academicWorkAwaitingReview}
            color="#f59e0b"
            sublabel="All work kinds"
          />
          <StatCard
            icon={<ClipboardList className="w-5 h-5" />}
            label="Assignments pending review"
            value={assignmentsAwaitingReview}
            color="#10b981"
            sublabel="work_kind = assignment"
          />
          <StatCard
            icon={<CheckSquare className="w-5 h-5" />}
            label="Tests scheduled today"
            value={testsScheduledToday}
            color="#6366f1"
            sublabel="Published / scheduled"
          />
          <StatCard
            icon={<Calendar className="w-5 h-5" />}
            label="Upcoming exams"
            value={upcomingExams}
            color="#3b5bdb"
            sublabel="Not yet results-published"
          />
          <StatCard
            icon={<PenLine className="w-5 h-5" />}
            label="Pending marks entry"
            value={pendingMarksEntry}
            color="#c08a3a"
            sublabel="Exams not locked"
          />
          <StatCard
            icon={<HelpCircle className="w-5 h-5" />}
            label="Open doubts"
            value={doubtsOpen}
            color="#cc5069"
            sublabel="From DoubtService"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setPage("myclasses")}
        className={cn(
          "w-full p-4 rounded-2xl border border-white/7 bg-[#131316] text-left hover:border-[#3b5bdb]/40",
        )}
      >
        <div className="text-xs font-bold text-white flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#3b5bdb]" /> Open My Classes
        </div>
        <div className="text-[10px] text-[#78788c] mt-1">
          Students · Attendance · Academic Work · Tests · Exams & Marks · Insights
        </div>
      </button>
    </div>
  );
}
