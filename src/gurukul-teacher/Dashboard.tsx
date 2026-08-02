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
  MessageCircle,
} from "lucide-react";
import { cn } from "./shared";
import type { TeacherPageKey } from "./nav";
import {
  AttendanceService,
  HomeworkService,
  TestService,
  MarksService,
  DoubtService,
  useAcademicLive,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";

export type TeacherClassTab =
  | "students"
  | "attendance"
  | "homework"
  | "tests"
  | "exams-marks"
  | "insights";

/** Deep-link My Classes to a specific tab. */
export function goTeacherClassTab(tab: TeacherClassTab) {
  try {
    sessionStorage.setItem("teacher.openTab", tab);
  } catch {
    /* ignore */
  }
}

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
      type="button"
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

function AttentionCard({
  icon,
  label,
  value,
  color,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "bg-[#131316] border border-white/7 rounded-2xl p-4 flex items-start gap-3 text-left w-full",
        onClick && "hover:border-white/15 hover:bg-white/3 transition-all cursor-pointer",
      )}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${color}18`, color }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xl font-black text-white tabular-nums">{value}</div>
        <div className="text-[10px] text-[#78788c] font-medium mt-0.5">{label}</div>
        {hint && <div className="text-[9px] text-[#46465a] mt-0.5">{hint}</div>}
      </div>
    </button>
  );
}

function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Teacher command center — what needs attention + quick actions that land on the right tab. */
export default function TeacherHome({ setPage }: { setPage: (p: TeacherPageKey) => void }) {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["attendance", "homework", "test", "marks", "profile"]);
  const [loading, setLoading] = useState(true);
  const [classCount, setClassCount] = useState(0);
  const [classNames, setClassNames] = useState<string[]>([]);
  const [ctClasses, setCtClasses] = useState(0);
  const [attendancePending, setAttendancePending] = useState(0);
  const [academicWorkAwaitingReview, setAcademicWorkAwaitingReview] = useState(0);
  const [testsCount, setTestsCount] = useState(0);
  const [upcomingExams, setUpcomingExams] = useState(0);
  const [pendingMarksEntry, setPendingMarksEntry] = useState(0);
  const [doubtsOpen, setDoubtsOpen] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const openTab = (tab: TeacherClassTab) => {
    goTeacherClassTab(tab);
    setPage("myclasses");
  };

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const classes = await AttendanceService.listAssignedClasses(ctx);
        const todayDate = todayIsoDate();
        let awReview = 0;
        let testsN = 0;
        let upcoming = 0;
        let pendingMarks = 0;
        let attPending = 0;
        let ct = 0;

        for (const c of classes) {
          if (c.isClassTeacher) {
            ct += 1;
            try {
              const existing = await AttendanceService.listForClassDate(ctx, c.id, todayDate);
              if (!existing.length) attPending += 1;
            } catch {
              /* ignore */
            }
          }

          try {
            const hw = await HomeworkService.listForClassWithStats(ctx, c.id, { limit: 100 });
            for (const h of hw) awReview += h.awaitingReview;
          } catch {
            /* ignore */
          }

          try {
            const tests = (await TestService.listForClass(ctx, c.id)) as {
              status?: string;
              is_published?: boolean;
            }[];
            testsN += tests.filter((t) => {
              const st = String(t.status ?? (t.is_published ? "published" : "draft"));
              return st === "draft" || st === "scheduled";
            }).length;
          } catch {
            /* ignore */
          }

          try {
            const exams = await MarksService.listExamsForClass(ctx, c.id, { limit: 100 });
            for (const e of exams) {
              if (!e.resultsPublishedAt && e.examDate && e.examDate >= todayDate) upcoming += 1;
              if (!e.marksLocked) pendingMarks += 1;
            }
          } catch {
            /* ignore */
          }
        }

        let open = 0;
        try {
          const doubts = await DoubtService.list(ctx);
          open = (doubts as { status?: string }[]).filter(
            (d) => d.status === "unsolved",
          ).length;
        } catch {
          open = 0;
        }

        if (cancelled) return;
        setClassCount(classes.length);
        setClassNames(classes.map((c) => `${c.name} ${c.section}`.trim()));
        setCtClasses(ct);
        setAttendancePending(attPending);
        setAcademicWorkAwaitingReview(awReview);
        setTestsCount(testsN);
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
  }, [ready, ctx, liveVersion]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[#78788c] text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading your day…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#3b5bdb]/10 to-[#f59e0b]/5 border border-[#3b5bdb]/20 rounded-2xl p-5">
        <div className="text-sm font-black text-white">Good to go — here is your day</div>
        <div className="text-xs text-[#78788c] mt-0.5">
          {classCount} class{classCount === 1 ? "" : "es"}
          {ctClasses > 0 ? ` · class teacher of ${ctClasses}` : ""}
          {classNames.length > 0
            ? ` · ${classNames.slice(0, 4).join(", ")}${classNames.length > 4 ? "…" : ""}`
            : ""}
        </div>
        {error && <div className="text-xs text-[#cc5069] mt-2">{error}</div>}
      </div>

      <div>
        <div className="text-[10px] font-bold text-[#46465a] uppercase tracking-wider mb-3">
          Quick actions
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <QuickAction
            icon={<Users className="w-5 h-5" />}
            label="Mark Attendance"
            color="#f59e0b"
            onClick={() => openTab("attendance")}
          />
          <QuickAction
            icon={<BookOpen className="w-5 h-5" />}
            label="Create Homework"
            color="#10b981"
            onClick={() => openTab("homework")}
          />
          <QuickAction
            icon={<ClipboardList className="w-5 h-5" />}
            label="Create Test"
            color="#6366f1"
            onClick={() => openTab("tests")}
          />
          <QuickAction
            icon={<PenLine className="w-5 h-5" />}
            label="Enter Marks"
            color="#3b5bdb"
            onClick={() => openTab("exams-marks")}
          />
          <QuickAction
            icon={<CheckSquare className="w-5 h-5" />}
            label="Review Homework"
            color="#c08a3a"
            onClick={() => openTab("homework")}
          />
          <QuickAction
            icon={<HelpCircle className="w-5 h-5" />}
            label="Student Doubts"
            color="#cc5069"
            onClick={() => setPage("doubts")}
          />
          <QuickAction
            icon={<MessageCircle className="w-5 h-5" />}
            label="Announcements"
            color="#78788c"
            onClick={() => setPage("announcements")}
          />
          <QuickAction
            icon={<FileText className="w-5 h-5" />}
            label="Apply Leave"
            color="#46465a"
            onClick={() => setPage("leave")}
          />
        </div>
      </div>

      <div>
        <div className="text-[10px] font-bold text-[#46465a] uppercase tracking-wider mb-3">
          Needs your attention
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <AttentionCard
            icon={<Users className="w-5 h-5" />}
            label="Attendance pending today"
            value={attendancePending}
            color="#f59e0b"
            hint={ctClasses ? "Class teacher classes without marks today" : "No class-teacher classes"}
            onClick={() => openTab("attendance")}
          />
          <AttentionCard
            icon={<BookOpen className="w-5 h-5" />}
            label="Work awaiting review"
            value={academicWorkAwaitingReview}
            color="#c08a3a"
            hint="Submitted / late queue"
            onClick={() => openTab("homework")}
          />
          <AttentionCard
            icon={<ClipboardList className="w-5 h-5" />}
            label="Tests to publish"
            value={testsCount}
            color="#6366f1"
            hint="Draft or scheduled tests"
            onClick={() => openTab("tests")}
          />
          <AttentionCard
            icon={<Calendar className="w-5 h-5" />}
            label="Upcoming exams"
            value={upcomingExams}
            color="#3b5bdb"
            hint="Not yet published"
            onClick={() => openTab("exams-marks")}
          />
          <AttentionCard
            icon={<PenLine className="w-5 h-5" />}
            label="Marks pending entry"
            value={pendingMarksEntry}
            color="#10b981"
            hint="Subjects not locked yet"
            onClick={() => openTab("exams-marks")}
          />
          <AttentionCard
            icon={<HelpCircle className="w-5 h-5" />}
            label="Open student doubts"
            value={doubtsOpen}
            color="#cc5069"
            onClick={() => setPage("doubts")}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => openTab("students")}
        className={cn(
          "w-full p-4 rounded-2xl border border-white/7 bg-[#131316] text-left hover:border-[#3b5bdb]/40",
        )}
      >
        <div className="text-xs font-bold text-white flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#3b5bdb]" /> Open My Classes
        </div>
        <div className="text-[10px] text-[#78788c] mt-1">
          Students · Attendance · Homework · Tests · Exams & Marks · Insights
        </div>
      </button>
    </div>
  );
}
