import { useEffect, useRef, useState } from "react";
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
  Megaphone,
  AlertTriangle,
} from "lucide-react";
import { cn } from "./shared";
import type { TeacherPageKey } from "./nav";
import {
  AttendanceService,
  HomeworkService,
  TestService,
  MarksService,
  DoubtService,
  AcademicProfileService,
  useAcademicLive,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { toErrorMessage } from "@/lib/presentation";

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
      className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-border/70 bg-surface hover:border-border hover:bg-muted transition-all group text-center"
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center transition-all group-hover:scale-110"
        style={{ background: `${color}18`, color }}
      >
        {icon}
      </div>
      <div className="text-[10px] font-semibold text-muted-foreground group-hover:text-foreground transition-all leading-tight">
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
        "bg-surface border border-border/70 rounded-2xl p-4 flex items-start gap-3 text-left w-full",
        onClick && "hover:border-border hover:bg-muted transition-all cursor-pointer",
      )}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${color}18`, color }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xl font-black text-foreground tabular-nums">{value}</div>
        <div className="text-[10px] text-muted-foreground font-medium mt-0.5">{label}</div>
        {hint && <div className="text-[9px] text-muted-foreground mt-0.5">{hint}</div>}
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
  const [atRiskStudents, setAtRiskStudents] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const openTab = (tab: TeacherClassTab) => {
    goTeacherClassTab(tab);
    setPage("myclasses");
  };

  useEffect(() => {
    if (!ready) return;
    if (!ctx) {
      setLoading(false);
      setError("Academic session unavailable. Sign out and back in, or ask admin to link your teacher account.");
      setClassCount(0);
      setClassNames([]);
      setCtClasses(0);
      setAttendancePending(0);
      setAcademicWorkAwaitingReview(0);
      setTestsCount(0);
      setUpcomingExams(0);
      setPendingMarksEntry(0);
      setDoubtsOpen(0);
      setAtRiskStudents(0);
      return;
    }
    let cancelled = false;
    const isFirst = !loadedRef.current;
    (async () => {
      if (isFirst) setLoading(true);
      try {
        const classes = await AttendanceService.listAssignedClasses(ctx);
        const todayDate = todayIsoDate();
        const partialErrors: string[] = [];

        // Every class's 5 lookups, and all classes, run concurrently instead
        // of one long sequential chain — this was the dominant cause of the
        // multi-second dashboard load (each cross-region RPC is ~400ms; a
        // sequential chain of 5 x N classes compounds linearly).
        const [classResults, doubtsResult] = await Promise.all([
          Promise.all(
            classes.map(async (c) => {
              const [attRes, hwRes, testsRes, examsRes, riskRes] = await Promise.allSettled([
                c.isClassTeacher
                  ? AttendanceService.listForClassDate(ctx, c.id, todayDate)
                  : Promise.resolve(null),
                HomeworkService.listForClassWithStats(ctx, c.id, { limit: 100 }),
                TestService.listForClass(ctx, c.id) as Promise<
                  { status?: string; is_published?: boolean }[]
                >,
                MarksService.listExamsForClass(ctx, c.id, { limit: 100 }),
                AcademicProfileService.listForClass(ctx, c.id),
              ]);

              const errors: string[] = [];
              let attPendingHere = false;
              let awReviewHere = 0;
              let testsNHere = 0;
              let upcomingHere = 0;
              let pendingMarksHere = 0;
              let atRiskHere = 0;

              if (c.isClassTeacher) {
                if (attRes.status === "fulfilled") {
                  if (!attRes.value || !attRes.value.length) attPendingHere = true;
                } else {
                  errors.push("attendance");
                }
              }

              if (hwRes.status === "fulfilled") {
                for (const h of hwRes.value) awReviewHere += h.awaitingReview;
              } else {
                errors.push("homework");
              }

              if (testsRes.status === "fulfilled") {
                testsNHere = testsRes.value.filter((t) => {
                  const st = String(t.status ?? (t.is_published ? "published" : "draft"));
                  return st === "draft" || st === "scheduled";
                }).length;
              } else {
                errors.push("tests");
              }

              if (examsRes.status === "fulfilled") {
                for (const e of examsRes.value) {
                  if (!e.resultsPublishedAt && e.examDate && e.examDate >= todayDate) upcomingHere += 1;
                  if (!e.marksLocked) pendingMarksHere += 1;
                }
              } else {
                errors.push("exams");
              }

              if (riskRes.status === "fulfilled") {
                for (const p of riskRes.value) {
                  if (p.attendanceRiskBand === "elevated" || p.attendanceRiskBand === "high") atRiskHere += 1;
                  else if (p.homeworkConsistencyBand === "elevated" || p.homeworkConsistencyBand === "high") atRiskHere += 1;
                }
              } else {
                errors.push("risk");
              }

              return {
                isCt: c.isClassTeacher,
                attPendingHere,
                awReviewHere,
                testsNHere,
                upcomingHere,
                pendingMarksHere,
                atRiskHere,
                errors,
              };
            }),
          ),
          DoubtService.list(ctx, { status: "open" }).catch(() => null),
        ]);

        let awReview = 0;
        let testsN = 0;
        let upcoming = 0;
        let pendingMarks = 0;
        let attPending = 0;
        let ct = 0;
        let atRisk = 0;
        for (const r of classResults) {
          if (r.isCt) {
            ct += 1;
            if (r.attPendingHere) attPending += 1;
          }
          awReview += r.awReviewHere;
          testsN += r.testsNHere;
          upcoming += r.upcomingHere;
          pendingMarks += r.pendingMarksHere;
          atRisk += r.atRiskHere;
          partialErrors.push(...r.errors);
        }
        const open = doubtsResult ? doubtsResult.length : 0;
        if (doubtsResult === null) partialErrors.push("doubts");

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
        setAtRiskStudents(atRisk);
        const unique = [...new Set(partialErrors)];
        setError(
          unique.length
            ? `Some dashboard counts may be incomplete (${unique.join(", ")} failed to load).`
            : null,
        );
        loadedRef.current = true;
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, "Failed to load dashboard"));
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
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading your day…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#3b5bdb]/10 to-[#f59e0b]/5 border border-[#3b5bdb]/20 rounded-2xl p-5">
        <div className="text-sm font-black text-foreground">Good to go — here is your day</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {classCount} class{classCount === 1 ? "" : "es"}
          {ctClasses > 0 ? ` · class teacher of ${ctClasses}` : ""}
          {classNames.length > 0
            ? ` · ${classNames.slice(0, 4).join(", ")}${classNames.length > 4 ? "…" : ""}`
            : ""}
        </div>
        {error && <div className="text-xs text-destructive mt-2">{error}</div>}
      </div>

      <div>
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
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
            icon={<Megaphone className="w-5 h-5" />}
            label="Announcements"
            color="#78788c"
            onClick={() => setPage("announcements")}
          />
          <QuickAction
            icon={<MessageCircle className="w-5 h-5" />}
            label="Communication"
            color="#6366f1"
            onClick={() => setPage("communication")}
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
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
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
            icon={<AlertTriangle className="w-5 h-5" />}
            label="Students at risk"
            value={atRiskStudents}
            color="#cc5069"
            hint="Elevated/high attendance or homework risk (EIE)"
            onClick={() => openTab("insights")}
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
          "w-full p-4 rounded-2xl border border-border/70 bg-surface text-left hover:border-[#3b5bdb]/40",
        )}
      >
        <div className="text-xs font-bold text-foreground flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#3b5bdb]" /> Open My Classes
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">
          Students · Attendance · Homework · Tests · Exams & Marks · Insights
        </div>
      </button>
    </div>
  );
}
