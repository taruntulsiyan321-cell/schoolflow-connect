import { useEffect, useMemo, useRef, useState } from "react";
import { withAlpha } from "@/lib/colorAlpha";
import {
  Search,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Plus,
  Save,
  Send,
  Archive,
  BarChart3,
  Download,
  Trash2,
  Lock,
  Unlock,
  BookOpen,
  PenLine,
  Upload,
  ArrowUp,
  ArrowDown,
  X,
} from "lucide-react";
import { cn, InitialsAvatar } from "./shared";
import {
  AttendanceService,
  AcademicProfileService,
  AnalyticsService,
  HomeworkService,
  MarksService,
  RemarksService,
  TestService,
  ProgressionService,
  TEST_KIND_LABELS,
  useAcademicLive,
  type ClassStudentRow,
  type StudentAcademicProfile,
  type StudentHomeworkRow,
  type TeacherRemark,
  type TestKind,
  type TeacherProgressionInsights,
} from "@/academic";
import type {
  BankQuestion,
  ManualQuestionInput,
  TestClassReport,
  TestListRow,
  TestStudentReport,
} from "@/academic/services/testService";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import type { ExamRecord, MarksRecord } from "@/academic/repository/marksRepository";
import type { HomeworkAttachmentMeta } from "@/academic/repository/homeworkRepository";
import { AttachmentComposer, AttachmentList } from "./AttachmentUI";
import {
  displaySubject,
  displayTopic,
  toCountLabel,
  toDisplayText,
  toEnumLabel,
  toErrorMessage,
  toPercentLabel,
  toPersonName,
} from "@/lib/presentation";
import { exportCSV } from "@/lib/exportCsv";
import { answerToText } from "@/academic/services/answerText";
import {
  classReportCsvRows,
  studentReportCsvRows,
} from "@/academic/services/testReportSheets";
import { useResetOnIdentityChange } from "@/hooks/useInitialLoadGate";
import {
  ATTENDANCE_LOW,
  HOMEWORK_LOW,
  HOMEWORK_ITEM_NEEDS_ACTION,
  SUBJECT_AVERAGE_LOW,
} from "@/academic/metrics/thresholds";
import {
  ATTENDANCE_COMFORTABLE,
  HOMEWORK_HABIT_REGULAR,
  HOMEWORK_HABIT_INCONSISTENT,
} from "@/academic/metrics/bands";

export {
  LiveHomeworkTab,
  LiveAssignmentsTab,
  LiveAcademicWorkTab,
} from "./LiveHomeworkPanels";

type LiveStudent = ClassStudentRow & {
  attendancePct: number | null;
  examsAvgPct: number | null;
  homeworkCompletionPct: number | null;
  testsAvgPct: number | null;
};

/**
 * The two presets the builder offers, and they are both MCQs.
 *
 * This list was six kinds — MCQ, True/False, fill, short, long, numerical — and
 * three of them produced questions nothing could mark: `rpc_test_submit` marks
 * by jsonb equality against the answer key, `correct` is NULL by constraint for
 * a written question, and no screen in the product marks an online test by
 * hand. A student's written answer therefore scored zero in silence and the
 * class report then ranked its topic 100% wrong.
 *
 * Ruled 2026-09-12 — "for the online test, only MCQ questions can be given" —
 * and made structural by `20260920020000`. True/False survives as what it
 * always was underneath: a two-option MCQ.
 */
const QUESTION_PRESETS = [
  { value: "mcq" as const, label: "Multiple choice", options: ["", "", "", ""] },
  { value: "true_false" as const, label: "True / False", options: ["True", "False"] },
];

/**
 * CHUNK 10.7. Four sites on the teacher header strip read
 * `{Math.round(analytics.avgAttendancePct)}%`, and that field became
 * `number | null` in Chunk 10 when "not measured" got a way to be expressed.
 *
 * `Math.round(null)` is 0. So a class nobody had marked rendered a confident
 * 0% — the same defect as `null < 75`, one operator along, and invisible to the
 * compiler until strictNullChecks.
 *
 * One helper rather than four inline ternaries: the point of the null contract
 * is that "we did not measure this" has a single rendering.
 */

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground text-xs gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> {label}
    </div>
  );
}

const TEST_KINDS = Object.keys(TEST_KIND_LABELS) as TestKind[];

/**
 * A row of `public.tests`, and nothing else.
 *
 * This carried `subject`, `is_published`, `max_marks` and `question_count`.
 * None of the four is a column on `tests` — Chunk 7.5 moved the subject to the
 * section_subject anchor (§10.22) and replaced `is_published` with `status`,
 * and the mark column is `max_mark`. Every read of them was `undefined`, so
 * each was a fallback that could never fire and a display that could never be
 * right: `question_count ?? 0` printed "0 Q" against every test in the list.
 */
type TestRow = {
  id: string;
  title?: string;
  status?: string;
  test_kind?: string;
  duration_sec?: number;
  total_marks?: number | null;
  passing_marks?: number | null;
  created_at?: string | null;
};

function resolveTestStatus(t: { status?: string | null }): string {
  // `status` is NOT NULL on `tests`, so the old `is_published` fallback below
  // this line was unreachable as well as addressed to a missing column.
  return t.status ? String(t.status) : "draft";
}

/** Live roster + AcademicProfileService metrics + student detail panels. */
export function LiveStudentsTab({ classId }: { classId: string }) {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive([
    "attendance",
    "homework",
    "marks",
    "examination",
    "test",
    "profile",
    "xp",
  ]);
  const [rows, setRows] = useState<LiveStudent[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LiveStudent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [homeworkRows, setHomeworkRows] = useState<StudentHomeworkRow[]>([]);
  const [recentMarks, setRecentMarks] = useState<MarksRecord[]>([]);
  const [remarks, setRemarks] = useState<TeacherRemark[]>([]);
  const [remarkDraft, setRemarkDraft] = useState("");
  const [remarkSaving, setRemarkSaving] = useState(false);
  const [attendanceHistory, setAttendanceHistory] = useState<
    Awaited<ReturnType<typeof AttendanceService.listForStudent>>
  >([]);
  const [profile, setProfile] = useState<StudentAcademicProfile | null>(null);

  useResetOnIdentityChange(loadedRef, classId);

  useEffect(() => {
    if (!ready || !ctx || !classId) return;
    let cancelled = false;
    const isFirst = !loadedRef.current;
    (async () => {
      if (isFirst) setLoading(true);
      setError(null);
      try {
        const settled = await Promise.allSettled([
          AttendanceService.listClassStudents(ctx, classId),
          AcademicProfileService.listForClass(ctx, classId, { limit: 200 }),
        ]);
        if (cancelled) return;
        const students = settled[0].status === "fulfilled" ? settled[0].value : [];
        const profilesOk = settled[1].status === "fulfilled";
        const profiles = settled[1].status === "fulfilled" ? settled[1].value : [];
        if (settled[0].status === "rejected") {
          throw settled[0].reason instanceof Error
            ? settled[0].reason
            : new Error("Failed to load students");
        }
        const byId = new Map(profiles.map((p) => [p.studentId, p]));
        setRows(
          students.map((s) => {
            const p = byId.get(s.id);
            return {
              ...s,
              attendancePct: p ? Math.round(p.attendancePct) : null,
              examsAvgPct: p ? Math.round(p.examsAvgPct) : null,
              homeworkCompletionPct: p ? Math.round(p.homeworkCompletionPct) : null,
              testsAvgPct: p ? Math.round(p.testsAvgPct) : null,
            };
          }),
        );
        setError(
          profilesOk
            ? null
            : "Academic profiles failed to load — student percentages shown as —.",
        );
        loadedRef.current = true;
      } catch (e) {
        if (!cancelled) setError(errMsg(e, "Failed to load students"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, classId, liveVersion]);

  useEffect(() => {
    if (!ready || !ctx || !selected) {
      setHomeworkRows([]);
      setRecentMarks([]);
      setRemarks([]);
      setAttendanceHistory([]);
      setProfile(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const settled = await Promise.allSettled([
          HomeworkService.listForStudent(ctx, selected.id),
          MarksService.listForStudent(ctx, selected.id, { limit: 10 }),
          RemarksService.listForStudent(ctx, selected.id, { limit: 10 }),
          AttendanceService.listForStudent(ctx, selected.id, { limit: 14 }),
          AcademicProfileService.get(ctx, selected.id),
        ]);
        if (cancelled) return;
        const errors: string[] = [];
        if (settled[0].status === "fulfilled") setHomeworkRows(settled[0].value);
        else {
          setHomeworkRows([]);
          errors.push(errMsg(settled[0].reason, "Homework failed"));
        }
        if (settled[1].status === "fulfilled") setRecentMarks(settled[1].value.slice(0, 8));
        else {
          setRecentMarks([]);
          errors.push(errMsg(settled[1].reason, "Marks failed"));
        }
        if (settled[2].status === "fulfilled") setRemarks(settled[2].value);
        else {
          setRemarks([]);
          errors.push(errMsg(settled[2].reason, "Remarks failed"));
        }
        if (settled[3].status === "fulfilled") setAttendanceHistory(settled[3].value);
        else {
          setAttendanceHistory([]);
          errors.push(errMsg(settled[3].reason, "Attendance history failed"));
        }
        if (settled[4].status === "fulfilled") setProfile(settled[4].value);
        else setProfile(null);
        if (errors.length) setDetailError(errors.join(" · "));
      } catch (e) {
        if (!cancelled) setDetailError(errMsg(e, "Failed to load student detail"));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        (s.rollNumber ?? "").toLowerCase().includes(q) ||
        (s.admissionNumber ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const pendingHomework = useMemo(
    () =>
      homeworkRows.filter(
        (r) => r.displayStatus === "Assigned" || r.displayStatus === "Late",
      ),
    [homeworkRows],
  );

  const submittedHomework = useMemo(
    () =>
      homeworkRows.filter((r) =>
        ["Submitted", "Late", "Graded", "Reviewed", "Completed"].includes(r.displayStatus),
      ),
    [homeworkRows],
  );

  const weakSubjects = useMemo(() => {
    const m = profile?.metrics ?? {};
    const raw = m.weakTopics ?? m.weakSubjects;
    return Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
  }, [profile]);

  const attendanceConcern = useMemo(() => {
    const recent = attendanceHistory.slice(0, 10);
    if (!recent.length) return false;
    const bad = recent.filter((a) => a.status === "absent").length;
    return bad >= 3 || (selected?.attendancePct ?? 100) < ATTENDANCE_LOW;
  }, [attendanceHistory, selected]);

  const homeworkHabit = useMemo(() => {
    if (!homeworkRows.length) return "No homework assigned yet";
    const rate = selected?.homeworkCompletionPct;
    if (rate == null) return "Homework metrics unavailable";
    if (pendingHomework.length >= 3) return "Often leaves homework incomplete";
    if (rate >= HOMEWORK_HABIT_REGULAR) return "Submits homework regularly";
    if (rate >= HOMEWORK_HABIT_INCONSISTENT) return "Inconsistent homework submissions";
    return "Homework submissions are a concern";
  }, [homeworkRows.length, selected, pendingHomework.length]);

  const report = useMemo(() => {
    if (!selected) {
      return {
        verdict: "Insufficient data",
        color: "hsl(var(--muted-foreground))",
        answers: [] as string[],
        actions: [] as string[],
        intervention: false,
      };
    }
    const answers: string[] = [];
    const actions: string[] = [];
    const att = selected.attendancePct ?? 0;
    const hw = selected.homeworkCompletionPct ?? 0;
    const testsAvg = selected.testsAvgPct ?? 0;
    const examsAvg = selected.examsAvgPct ?? 0;

    // NO MEAN. Attendance, homework, test average and exam average measure
    // four different things against four different lines; averaging them
    // produced a number with no unit that could be "60" because attendance was
    // 100 and marks were 20. Each rate is now checked against ITS OWN
    // threshold, and where one signal is needed it is the WORST rate, NAMED.
    const rates = [
      { label: "attendance", pct: att, low: ATTENDANCE_LOW },
      { label: "homework", pct: hw, low: HOMEWORK_LOW },
      { label: "test average", pct: testsAvg, low: SUBJECT_AVERAGE_LOW },
      { label: "exam average", pct: examsAvg, low: SUBJECT_AVERAGE_LOW },
    ];
    // 0 means "not measured yet" in these fields, not "zero percent".
    const measured = rates.filter((m) => m.pct > 0);
    const below = measured.filter((m) => m.pct < m.low);
    // Worst = furthest below its OWN line, so the comparison stays within one
    // measure rather than across four.
    const worst = below.slice().sort((a, b) => a.pct - a.low - (b.pct - b.low))[0];

    if (att >= ATTENDANCE_COMFORTABLE) answers.push("Attendance is healthy");
    else if (att > 0) answers.push(`Attendance is a problem (${att}%)`);
    else answers.push("Attendance data not available yet");

    answers.push(homeworkHabit);
    if (pendingHomework.length > 0) {
      answers.push(`${pendingHomework.length} homework item(s) still pending`);
      actions.push("Follow up on pending homework");
    }

    // Tests and exams are reported SEPARATELY against SUBJECT_AVERAGE_LOW.
    // They were previously averaged into one "academic" figure, which hid the
    // common real case: passing tests while failing exams, or the reverse.
    if (testsAvg > 0) {
      answers.push(
        testsAvg < SUBJECT_AVERAGE_LOW
          ? `Test average is below ${SUBJECT_AVERAGE_LOW}% (${Math.round(testsAvg)}%)`
          : `Test average ${Math.round(testsAvg)}%`,
      );
    }
    if (examsAvg > 0) {
      answers.push(
        examsAvg < SUBJECT_AVERAGE_LOW
          ? `Exam average is below ${SUBJECT_AVERAGE_LOW}% (${Math.round(examsAvg)}%)`
          : `Exam average ${Math.round(examsAvg)}%`,
      );
    }
    if (testsAvg === 0 && examsAvg === 0) {
      answers.push("Not enough test/exam marks yet to judge academic level");
    }

    if (weakSubjects.length) {
      answers.push(`Needs attention in: ${weakSubjects.slice(0, 3).join(", ")}`);
      actions.push(`Focus support on ${weakSubjects[0]}`);
    }
    if (attendanceConcern) {
      actions.push("Talk to student/parent about attendance");
    }

    let verdict = "Insufficient data";
    let color = "hsl(var(--muted-foreground))";
    let intervention = false;
    if (measured.length >= 2) {
      if (below.length === 0 && pendingHomework.length <= 1 && !attendanceConcern) {
        verdict = "No measure below its threshold";
        color = "hsl(var(--success))";
      } else if (below.length === 0) {
        verdict = "Stable — watch closely";
        color = "hsl(var(--primary))";
      } else if (below.length === 1) {
        verdict = `Needs support — ${worst.label}`;
        color = "hsl(var(--warning))";
        intervention = true;
        actions.push(`Plan a short check-in about ${worst.label} this week`);
      } else {
        verdict = `At risk — intervene (${worst.label} lowest)`;
        color = "hsl(var(--destructive))";
        intervention = true;
        actions.push("Escalate with class teacher / parent meeting");
      }
    } else if (attendanceConcern || pendingHomework.length >= 2) {
      verdict = "Needs support";
      color = "hsl(var(--warning))";
      intervention = true;
    }

    if (!actions.length && verdict === "No measure below its threshold") {
      actions.push("Keep encouraging — no urgent action");
    }

    return { verdict, color, answers, actions, intervention };
  }, [
    selected,
    homeworkHabit,
    pendingHomework.length,
    weakSubjects,
    attendanceConcern,
  ]);

  if (loading) return <Loading label="Loading roster…" />;
  if (error && rows.length === 0) {
    return <div className="text-xs text-destructive py-8 text-center">{error}</div>;
  }

  if (selected) {
    const parentContact =
      [selected.parentName, selected.parentMobile].filter(Boolean).join(" · ") || null;

    return (
      <div className="space-y-5">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="w-3 h-3 rotate-180" /> Back to Students
        </button>

        <div className="bg-surface border border-border/70 rounded-[2px] p-5 space-y-4">
          <div className="flex items-center gap-4">
            {selected.photoUrl ? (
              <img src={selected.photoUrl} alt="" className="w-14 h-14 rounded-[2px] object-cover" />
            ) : (
              <InitialsAvatar name={selected.fullName} size="lg" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-base font-black text-foreground truncate">{selected.fullName}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Roll {selected.rollNumber ?? "—"}
                {parentContact ? ` · Parent ${parentContact}` : ""}
              </div>
            </div>
          </div>
          <div
            className="rounded-[2px] px-4 py-3 border"
            style={{ background: `${withAlpha(report.color, 0.09)}`, borderColor: `${withAlpha(report.color, 0.25)}` }}
          >
            <div className="text-sm font-black" style={{ color: report.color }}>
              {report.verdict}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              {report.intervention
                ? "Teacher intervention is recommended."
                : "No urgent intervention required."}
            </div>
          </div>
        </div>

        {detailError && (
          <div className="rounded-[2px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {detailError}
          </div>
        )}

        {detailLoading ? (
          <Loading label="Building academic report…" />
        ) : (
          <>
            <div className="bg-surface border border-border/70 rounded-[2px] p-4 space-y-2">
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                What you should know
              </div>
              {report.answers.map((line) => (
                <div key={line} className="text-[12px] text-foreground leading-snug">
                  · {line}
                </div>
              ))}
            </div>

            <div className="bg-surface border border-border/70 rounded-[2px] p-4 space-y-2">
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Suggested actions
              </div>
              {report.actions.map((line) => (
                <div key={line} className="text-[12px] text-warning leading-snug">
                  → {line}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                {
                  label: "Attendance",
                  value: selected.attendancePct == null ? "—" : `${selected.attendancePct}%`,
                  warn: selected.attendancePct != null && selected.attendancePct < ATTENDANCE_LOW,
                },
                {
                  label: "Homework",
                  value:
                    selected.homeworkCompletionPct == null
                      ? "—"
                      : `${selected.homeworkCompletionPct}%`,
                  warn:
                    selected.homeworkCompletionPct != null && selected.homeworkCompletionPct < HOMEWORK_LOW,
                },
                {
                  label: "Pending HW",
                  value: String(pendingHomework.length),
                  warn: pendingHomework.length > 0,
                },
                {
                  label: "Tests / Exams",
                  value: `${selected.testsAvgPct ?? "—"} / ${selected.examsAvgPct ?? "—"}`,
                  warn:
                    (selected.testsAvgPct != null &&
                      selected.testsAvgPct > 0 &&
                      selected.testsAvgPct < SUBJECT_AVERAGE_LOW) ||
                    (selected.examsAvgPct != null &&
                      selected.examsAvgPct > 0 &&
                      selected.examsAvgPct < SUBJECT_AVERAGE_LOW),
                },
              ].map((m) => (
                <div
                  key={m.label}
                  className="bg-surface border border-border/70 rounded-[2px] p-3 text-center"
                >
                  <div
                    className="text-sm font-black tabular-nums"
                    style={{ color: m.warn ? "hsl(var(--destructive))" : "#fff" }}
                  >
                    {m.value}
                  </div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">{m.label}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-surface border border-border/70 rounded-[2px] p-4 space-y-2">
                <div className="text-xs font-bold text-foreground">Pending homework</div>
                {pendingHomework.length === 0 ? (
                  <div className="text-[10px] text-muted-foreground">Caught up — nothing pending</div>
                ) : (
                  pendingHomework.slice(0, 6).map((r) => (
                    <div
                      key={r.homework.id}
                      className="flex justify-between gap-2 text-[11px]"
                    >
                      <span className="text-foreground truncate">{r.homework.title}</span>
                      <span className="text-[9px] text-warning shrink-0">{r.displayStatus}</span>
                    </div>
                  ))
                )}
                <div className="text-[9px] text-muted-foreground pt-1">
                  Submitted recently: {submittedHomework.length}
                </div>
              </div>
              <div className="bg-surface border border-border/70 rounded-[2px] p-4 space-y-2">
                <div className="text-xs font-bold text-foreground">Recent attendance</div>
                {attendanceHistory.length === 0 ? (
                  <div className="text-[10px] text-muted-foreground">No records yet</div>
                ) : (
                  attendanceHistory.slice(0, 8).map((a) => (
                    <div key={a.id} className="flex justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>{a.date}</span>
                      <span
                        className={cn(
                          "capitalize font-semibold",
                          a.status === "absent"
                            ? "text-destructive"
                            : "text-foreground",
                        )}
                      >
                        {toEnumLabel(a.status, "attendance_status")}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {(weakSubjects.length > 0 || remarks.length > 0) && (
              <div className="bg-surface border border-border/70 rounded-[2px] p-4 space-y-3">
                <div className="text-xs font-bold text-foreground">Teacher context</div>
                {weakSubjects.length > 0 && (
                  <div className="flex flex-wrap gap-1 items-center">
                    <span className="text-[10px] text-muted-foreground mr-1">Needs work:</span>
                    {weakSubjects.map((s) => (
                      <span
                        key={s}
                        className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-destructive/15 text-destructive"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                {remarks.slice(0, 4).map((r) => (
                  <div key={r.id} className="text-[11px] text-muted-foreground">
                    “{r.body}”
                  </div>
                ))}
                <div className="pt-2 space-y-2 border-t border-border">
                  <textarea
                    value={remarkDraft}
                    onChange={(e) => setRemarkDraft(e.target.value)}
                    rows={2}
                    placeholder="Add a remark for this student…"
                    className="w-full bg-muted border border-border rounded-[2px] px-3 py-2 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40 resize-none"
                  />
                  <button
                    type="button"
                    disabled={remarkSaving || remarkDraft.trim().length < 3 || !ctx || !selected}
                    onClick={() => {
                      if (!ctx || !selected) return;
                      void (async () => {
                        setRemarkSaving(true);
                        try {
                          const row = await RemarksService.create(ctx, {
                            studentId: selected.id,
                            classId,
                            body: remarkDraft,
                          });
                          setRemarks((prev) => [row, ...prev]);
                          setRemarkDraft("");
                        } catch (e) {
                          setDetailError(errMsg(e, "Could not save remark"));
                        } finally {
                          setRemarkSaving(false);
                        }
                      })();
                    }}
                    className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
                  >
                    {remarkSaving ? "Saving…" : "Save remark"}
                  </button>
                </div>
              </div>
            )}

            {!(weakSubjects.length > 0 || remarks.length > 0) && (
              <div className="bg-surface border border-border/70 rounded-[2px] p-4 space-y-2">
                <div className="text-xs font-bold text-foreground">Teacher remark</div>
                <div className="pt-2 space-y-2 border-t border-border">
                  <textarea
                    value={remarkDraft}
                    onChange={(e) => setRemarkDraft(e.target.value)}
                    rows={2}
                    placeholder="Add a remark for this student…"
                    className="w-full bg-muted border border-border rounded-[2px] px-3 py-2 text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40 resize-none"
                  />
                  <button
                    type="button"
                    disabled={remarkSaving || remarkDraft.trim().length < 3 || !ctx || !selected}
                    onClick={() => {
                      if (!ctx || !selected) return;
                      void (async () => {
                        setRemarkSaving(true);
                        try {
                          const row = await RemarksService.create(ctx, {
                            studentId: selected.id,
                            classId,
                            body: remarkDraft,
                          });
                          setRemarks((prev) => [row, ...prev]);
                          setRemarkDraft("");
                        } catch (e) {
                          setDetailError(errMsg(e, "Could not save remark"));
                        } finally {
                          setRemarkSaving(false);
                        }
                      })();
                    }}
                    className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
                  >
                    {remarkSaving ? "Saving…" : "Save remark"}
                  </button>
                </div>
              </div>
            )}

            {recentMarks.length > 0 && (
              <div className="bg-surface border border-border/70 rounded-[2px] p-4 space-y-2">
                <div className="text-xs font-bold text-foreground">Latest published marks</div>
                {recentMarks.slice(0, 5).map((m) => (
                  <div key={m.id} className="flex justify-between gap-2 text-[11px]">
                    <span className="text-muted-foreground truncate">
                      {m.remarks?.trim() || "Result"}
                    </span>
                    <span className="tabular-nums font-bold text-foreground">{m.marksObtained}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-xs text-warning px-3 py-2 rounded-[2px] bg-warning/10 border border-warning/20">
          {error}
        </div>
      )}
      <div className="text-[10px] text-muted-foreground">
        Open a student for an academic report — who needs help, and why.
      </div>
      <div className="flex items-center gap-2 bg-muted border border-border rounded-[2px] px-3 py-2">
        <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or roll number…"
          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
        />
      </div>
      <div className="text-[10px] text-muted-foreground">{filtered.length} students</div>
      <div className="space-y-2">
        {filtered.map((s) => {
          const flag =
            (s.attendancePct != null && s.attendancePct < ATTENDANCE_LOW) ||
            (s.homeworkCompletionPct != null && s.homeworkCompletionPct < HOMEWORK_LOW) ||
            (s.testsAvgPct != null && s.testsAvgPct > 0 && s.testsAvgPct < SUBJECT_AVERAGE_LOW);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelected(s)}
              className="w-full flex items-center gap-3 p-3 bg-surface border border-border/70 rounded-[2px] hover:border-border hover:bg-muted transition-all text-left group"
            >
              {s.photoUrl ? (
                <img src={s.photoUrl} alt="" className="w-9 h-9 rounded-[2px] object-cover" />
              ) : (
                <InitialsAvatar name={s.fullName} />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-foreground flex items-center gap-2">
                  {s.fullName}
                  {flag && (
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-destructive/20 text-destructive">
                      Needs attention
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Roll {s.rollNumber ?? "—"} · Att{" "}
                  {s.attendancePct == null ? "—" : `${s.attendancePct}%`} · HW{" "}
                  {s.homeworkCompletionPct == null ? "—" : `${s.homeworkCompletionPct}%`}
                </div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-xs text-muted-foreground">No students in this class.</div>
        )}
      </div>
    </div>
  );
}

type BuilderStep = "basics" | "source" | "library" | "manual" | "upload" | "review";
type QuestionSource = "library" | "manual" | "upload";
/** A question on the paper being built, with where it came from. */
type DraftQuestion = ManualQuestionInput & { localId: string; bankId?: string | null };
type PaperAttachment = HomeworkAttachmentMeta;

function newLocalId() {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** One bank question, as a draft question on this paper. Marks default to 1. */
function fromBank(b: BankQuestion): DraftQuestion {
  return {
    localId: newLocalId(),
    bankId: b.id,
    question: b.question,
    options: b.options,
    correctIndex: b.correctIndex,
    marks: 1,
    explanation: b.explanation,
    chapter: b.chapter,
    topic: b.topic,
  };
}

const emptyBasics = () => ({
  title: "",
  testKind: "class_test" as TestKind,
  durationMin: "30",
  maxMarks: "",
  instructions: "",
  /**
   * Chapter and topic, and they are not decoration: §10.22 requires a test to
   * carry its topic PER QUESTION, and `rpc_test_class_report` ranks weakest
   * topics off `test_questions.concept` falling back to `.chapter`. A paper
   * written without either ranks everything under "Unlabelled", which is a
   * report that cannot be acted on. Questions taken from the bank bring their
   * own; hand-written ones take these.
   */
  chapter: "",
  topic: "",
  publishMode: "draft" as "draft" | "now" | "schedule",
  scheduledAt: "",
});

/**
 * The question form, MCQ-shaped.
 *
 * `correct` was a free-text field the teacher typed the correct option's TEXT
 * into ("Correct option text *"). A typo, a trailing space or a changed option
 * produced an answer key naming no option — `{indexes: []}` — and then every
 * student's answer marked wrong with nothing on screen to explain it. The
 * correct option is now PICKED, so the mistake cannot be expressed: what
 * travels is its index.
 */
const emptyQuestionForm = () => ({
  preset: "mcq" as (typeof QUESTION_PRESETS)[number]["value"],
  question: "",
  options: ["", "", "", ""] as string[],
  correctIndex: null as number | null,
  marks: "1",
  explanation: "",
});

const DIFFICULTIES = ["easy", "medium", "hard"] as const;

export function LiveTestsTab({ classId, subject }: { classId: string; subject: string }) {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["test", "profile"]);
  /**
   * One row per test, from `rpc_test_list_for_class`, carrying what this screen
   * cannot compute: the question count (`test_questions` is closed to students,
   * so it is read through a definer) and how many of the class have handed in.
   * Both used to be absent — the list read `question_count` off the test row,
   * which is not a column there, and printed "0 Q" against every test.
   */
  const [tests, setTests] = useState<TestListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [step, setStep] = useState<BuilderStep>("basics");
  const [basics, setBasics] = useState(emptyBasics);
  const [source, setSource] = useState<QuestionSource | null>(null);
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [qForm, setQForm] = useState(emptyQuestionForm);
  const [attachments, setAttachments] = useState<PaperAttachment[]>([]);
  /**
   * The question-bank picker. The filters are the four the bank is actually
   * organised by — class level, subject, chapter, difficulty — plus a text
   * search. The eight-field grid this replaces included `board` (decided by the
   * school, not the teacher), `book` (no such column) and `kind` (every bank
   * row is an MCQ), and fed a service call that returned `[]` unconditionally.
   */
  const [bankClassLevel, setBankClassLevel] = useState<string>("");
  const [bankChapter, setBankChapter] = useState<string>("");
  const [bankDifficulty, setBankDifficulty] = useState<string>("");
  const [bankSearch, setBankSearch] = useState<string>("");
  const [bankChapters, setBankChapters] = useState<{ chapter: string; count: number }[]>([]);
  const [bankItems, setBankItems] = useState<BankQuestion[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);
  const [scheduleDraftId, setScheduleDraftId] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  /**
   * Editing the QUESTIONS of a test that already exists.
   *
   * Until now the only editable things were the title and the instructions, so
   * a typo in a question — or a key on the wrong option — could not be fixed:
   * the teacher had to delete the test and rebuild it, and a test cannot be
   * deleted once anyone has attempted it. The builder is reused rather than
   * reimplemented, so every rule it enforces (MCQ only, a key that names a real
   * option, whole marks) applies to an edit as well.
   *
   * `setQuestions` refuses outright once an attempt exists — replacing a
   * question would delete the answers given to it — so this is offered only
   * while nobody has handed in, and says so when they have.
   */
  const [editQuestionsFor, setEditQuestionsFor] = useState<string | null>(null);
  // §10.25 — the report. Held per test id, so opening a second one closes the
  // first rather than leaving two panels claiming to be "the" report.
  const [reportTestId, setReportTestId] = useState<string | null>(null);
  const [report, setReport] = useState<TestClassReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [drillStudentId, setDrillStudentId] = useState<string | null>(null);
  const [drill, setDrill] = useState<TestStudentReport | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  const closeReport = () => {
    setReportTestId(null);
    setReport(null);
    setReportError(null);
    setDrillStudentId(null);
    setDrill(null);
    setDrillError(null);
  };

  /**
   * Load the class report. No role check here and none in the service: the
   * whole rule lives in `can_read_test_report` (see 20260916000000). A teacher
   * who does not teach this section gets 42501 and reads it as a sentence.
   */
  const openReport = async (testId: string) => {
    if (!ctx) return;
    if (reportTestId === testId) {
      closeReport();
      return;
    }
    closeReport();
    setReportTestId(testId);
    setReportLoading(true);
    try {
      setReport(await TestService.classReport(ctx, testId));
    } catch (e) {
      setReportError(toErrorMessage(e, "Could not load the report for this test"));
    } finally {
      setReportLoading(false);
    }
  };

  const openDrill = async (testId: string, studentId: string) => {
    if (!ctx) return;
    if (drillStudentId === studentId) {
      setDrillStudentId(null);
      setDrill(null);
      setDrillError(null);
      return;
    }
    setDrillStudentId(studentId);
    setDrill(null);
    setDrillError(null);
    setDrillLoading(true);
    try {
      setDrill(await TestService.studentReport(ctx, testId, studentId));
    } catch (e) {
      setDrillError(toErrorMessage(e, "Could not load this student's report"));
    } finally {
      setDrillLoading(false);
    }
  };

  const reload = async () => {
    if (!ctx) return;
    const quiet = loadedRef.current;
    if (!quiet) setLoading(true);
    try {
      await HomeworkService.publishDueScheduled(ctx).catch(() => 0);
      // ONE call. This was two — the list, then a separate question count —
      // and neither could say how many students had handed in, which is the
      // fact a teacher opens a published test to find out.
      setTests(await TestService.listForClassDetailed(ctx, classId));
      setError(null);
      loadedRef.current = true;
    } catch (err) {
      setError(errMsg(err, "Failed to load tests"));
    } finally {
      setLoading(false);
    }
  };

  useResetOnIdentityChange(loadedRef, classId);
  useEffect(() => {
    if (!ready || !ctx) return;
    // An open report belongs to a test in the class being left. Keeping it on
    // screen would show one class's marks under another class's heading.
    closeReport();
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx, classId]);

  useEffect(() => {
    if (!ready || !ctx || !loadedRef.current) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVersion]);

  /**
   * The chapters the bank actually has questions for, at this class level and
   * subject. Offering a chapter with nothing behind it is worse than offering
   * none: the teacher picks it, sees an empty list, and cannot tell whether the
   * bank is empty or their filter is wrong. The count is on every option.
   */
  useEffect(() => {
    if (!ready || !ctx || step !== "library") return;
    const level = Number(bankClassLevel);
    if (!Number.isFinite(level) || level <= 0 || !subject) {
      setBankChapters([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await TestService.listBankChapters(ctx, { classLevel: level, subject });
        if (!cancelled) setBankChapters(rows);
      } catch {
        if (!cancelled) setBankChapters([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, step, bankClassLevel, subject]);

  useEffect(() => {
    if (!ready || !ctx || step !== "library") return;
    const level = Number(bankClassLevel);
    if (!Number.isFinite(level) || level <= 0) {
      setBankItems([]);
      setBankError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setBankLoading(true);
        setBankError(null);
        try {
          const items = await TestService.searchQuestionBank(ctx, {
            classLevel: level,
            // The subject is the section-subject this tab is already scoped to
            // (§10.22). A teacher picking Physics questions for a Maths test
            // would file the test under the wrong subject's analysis for the
            // rest of the year, so it is not offered as a filter.
            subject,
            chapter: bankChapter || null,
            difficulty: bankDifficulty || null,
            search: bankSearch || null,
            limit: 40,
          });
          if (!cancelled) setBankItems(items);
        } catch (e) {
          if (!cancelled) {
            setBankItems([]);
            setBankError(toErrorMessage(e, "Could not search the question bank"));
          }
        } finally {
          if (!cancelled) setBankLoading(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, ctx, step, bankClassLevel, subject, bankChapter, bankDifficulty, bankSearch]);

  const resetBuilder = () => {
    setBuilderOpen(false);
    setStep("basics");
    // Cleared FIRST in spirit: leaving it set would make the next new test's
    // save overwrite the paper that was being edited.
    setEditQuestionsFor(null);
    setBasics(emptyBasics());
    setSource(null);
    setQuestions([]);
    setQForm(emptyQuestionForm());
    setAttachments([]);
    setBankItems([]);
    setBankChapters([]);
    setBankChapter("");
    setBankDifficulty("");
    setBankSearch("");
    setBankError(null);
  };

  /**
   * Open the builder on a test that already exists, with its questions in it.
   * Saving replaces the paper through the same `setQuestions` the create path
   * uses — one writer, one set of rules.
   */
  const openQuestionEditor = async (t: TestListRow) => {
    if (!ctx) return;
    if ((t.submitted_count ?? 0) > 0) {
      setError(
        "Students have already handed this test in, so its questions cannot be changed — " +
          "replacing a question would delete the answers given to it. Create a new test instead.",
      );
      return;
    }
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const existing = await TestService.listQuestionsForEditing(ctx, t.id);
      setQuestions(existing.map((q) => ({ ...q, localId: newLocalId() })));
      setBasics((f) => ({
        ...f,
        title: String(t.title ?? ""),
        testKind: (t.test_kind as TestKind) ?? "class_test",
        durationMin: t.duration_sec ? String(Math.round(t.duration_sec / 60)) : f.durationMin,
        chapter: String(t.chapter ?? ""),
        topic: String(t.topic ?? ""),
      }));
      setEditQuestionsFor(t.id);
      setSource("manual");
      setBuilderOpen(true);
      setStep("manual");
    } catch (e) {
      setError(errMsg(e, "Could not load this test's questions"));
    } finally {
      setSaving(false);
    }
  };

  /** Save an edited paper back onto the test it came from. */
  const saveEditedQuestions = async () => {
    if (!ctx || !editQuestionsFor) return;
    if (questions.length === 0) {
      setError("A test needs at least one question. Delete the test instead if that is the intent.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await TestService.setQuestions(
        ctx,
        editQuestionsFor,
        questions.map(({ question, options, correctIndex, marks, explanation, chapter, topic }) => ({
          question, options, correctIndex, marks, explanation, chapter, topic,
        })),
      );
      if (basics.title.trim()) {
        await TestService.update(ctx, editQuestionsFor, { title: basics.title.trim() });
      }
      setSuccess(`Questions updated — ${questions.length} question(s), ${questionMarksTotal} marks`);
      resetBuilder();
      await reload();
    } catch (e) {
      setError(errMsg(e, "Could not save the questions"));
    } finally {
      setSaving(false);
    }
  };

  const openBuilder = () => {
    setError(null);
    setSuccess(null);
    setBuilderOpen(true);
    setStep("basics");
  };

  const questionMarksTotal = questions.reduce((s, q) => s + Number(q.marks ?? 1), 0);
  const durationMin = Math.max(1, Number(basics.durationMin) || 30);

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    if (!ctx) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await fn();
      setSuccess(`${label} succeeded`);
      await reload();
    } catch (e) {
      setError(errMsg(e, `${label} failed`));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Add the question on the form to the paper.
   *
   * Every refusal below names what is missing. The marks floor is 1 and whole:
   * this was `Math.max(0.5, ...)`, and a half mark cannot be represented by
   * `tests.max_mark` or `test_marks.mark` — both integer columns — so it was
   * silently rounded into the mark a parent and a principal read.
   */
  const addManualQuestion = () => {
    const question = qForm.question.trim();
    if (!question) {
      setError("Question text is required");
      return;
    }
    const options = qForm.options.map((o) => o.trim());
    const filled = options.filter(Boolean);
    if (filled.length < 2) {
      setError("A question needs at least two options");
      return;
    }
    if (options.some((o, i) => o === "" && i < options.length && options.slice(i + 1).some(Boolean))) {
      setError("Fill the options in order — there is a blank one above a filled one");
      return;
    }
    if (qForm.correctIndex == null || !filled[qForm.correctIndex]) {
      setError("Mark which option is the correct answer");
      return;
    }
    const marks = Number(qForm.marks);
    if (!Number.isInteger(marks) || marks < 1) {
      setError("Marks must be a whole number of at least 1");
      return;
    }

    setQuestions((prev) => [
      ...prev,
      {
        localId: newLocalId(),
        question,
        options: filled,
        correctIndex: qForm.correctIndex as number,
        marks,
        explanation: qForm.explanation.trim() || null,
        // The chapter and topic this tab is already scoped to. §10.22: a test
        // carries its topic PER QUESTION, and the class report ranks weak
        // topics off exactly this field — a question with none lands under
        // "Unlabelled".
        chapter: basics.chapter.trim() || null,
        topic: basics.topic.trim() || null,
      },
    ]);
    setQForm(emptyQuestionForm());
    setError(null);
  };

  const addBankQuestion = (b: BankQuestion) => {
    if (questions.some((q) => q.bankId === b.id)) {
      setError("That question is already on this paper");
      return;
    }
    setQuestions((prev) => [...prev, fromBank(b)]);
    setError(null);
  };

  const moveQuestion = (index: number, dir: -1 | 1) => {
    setQuestions((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const goFromBasics = () => {
    if (!basics.title.trim()) {
      setError("Title is required");
      return;
    }
    if (basics.publishMode === "schedule" && !basics.scheduledAt) {
      setError("Pick a schedule date/time, or choose Draft / Publish now");
      return;
    }
    setError(null);
    setStep("source");
  };

  const pickSource = (s: QuestionSource) => {
    setSource(s);
    setError(null);
    setStep(s);
  };

  /**
   * Save the paper.
   *
   * ── THE ORDERING, AND WHY IT CHANGED ────────────────────────────────────
   *
   * This used to create the test with `status: 'published'` and write the
   * questions AFTER. Between those two awaits the test was published with no
   * questions: a student refreshing their Tests screen was offered a paper
   * `rpc_test_start` then refused with "test has no questions" — and if the
   * question write failed at all, the test stayed published and empty for good.
   *
   * `TestService.createWithQuestions` does it in the only safe order — draft,
   * questions, then publish or schedule — and validates the whole paper before
   * a row exists, so a refused question costs the teacher nothing.
   */
  const submitBuilder = async (mode: "draft" | "now" | "schedule") => {
    if (!ctx) return;
    if (!basics.title.trim()) {
      setError("Title is required");
      setStep("basics");
      return;
    }
    if ((source === "manual" || source === "library") && questions.length === 0) {
      setError("Add at least one question, or switch source");
      setStep(source);
      return;
    }
    if (source === "upload" && attachments.length === 0) {
      setError("Add at least one paper attachment, or switch source");
      setStep("upload");
      return;
    }
    if (mode === "schedule" && !basics.scheduledAt) {
      setError("Schedule date/time is required");
      setStep("basics");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const durationSec = Math.max(60, Math.round(durationMin * 60));
      const maxMarksFromForm = basics.maxMarks ? Number(basics.maxMarks) : null;

      await TestService.createWithQuestions(
        ctx,
        {
          classId,
          title: basics.title.trim(),
          subject,
          testKind: basics.testKind,
          duration_sec: durationSec,
          maxMarks: maxMarksFromForm,
          instructions: basics.instructions.trim() || null,
          chapters: basics.chapter.trim() ? [basics.chapter.trim()] : undefined,
          topics: basics.topic.trim() ? [basics.topic.trim()] : undefined,
          paperAttachments: source === "upload" ? attachments : undefined,
        },
        source === "upload"
          ? []
          : questions.map(({ question, options, correctIndex, marks, explanation, chapter, topic }) => ({
              question,
              options,
              correctIndex,
              marks,
              explanation,
              chapter,
              topic,
            })),
        mode === "now"
          ? { mode: "now" }
          : mode === "schedule"
            ? { mode: "schedule", at: new Date(basics.scheduledAt).toISOString() }
            : { mode: "draft" },
      );

      setSuccess(
        mode === "now"
          ? `Published to this class — ${questions.length} question(s), ${questionMarksTotal} marks`
          : mode === "schedule"
            ? "Test scheduled successfully"
            : "Draft saved successfully",
      );
      resetBuilder();
      await reload();
    } catch (e) {
      setError(errMsg(e, "Failed to save test"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label="Loading tests…" />;

  if (builderOpen) {
    const stepLabel: Record<BuilderStep, string> = editQuestionsFor
      ? {
          basics: "Editing · Basics",
          source: "Editing · Source",
          library: "Editing · Question bank",
          manual: "Editing the questions",
          upload: "Editing · Upload",
          review: "Editing · Review",
        }
      : {
      basics: "A · Basics",
      source: "B · Source",
      library: "C · Library",
      manual: "C · Manual questions",
      upload: "C · Upload paper",
      review: "D · Review & Publish",
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              if (step === "basics") resetBuilder();
              else if (step === "source") setStep("basics");
              else if (step === "review") setStep(source ?? "source");
              else setStep("source");
            }}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="w-3 h-3" />
            {step === "basics" ? "Cancel" : "Back"}
          </button>
          <div className="text-[10px] font-bold text-primary">{stepLabel[step]}</div>
          <button
            type="button"
            onClick={resetBuilder}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {error && (
          <div className="rounded-[2px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {step === "basics" && (
          <div className="bg-surface border border-border rounded-[2px] p-4 space-y-3">
            <div className="text-sm font-bold text-foreground">Test basics</div>
            <input
              value={basics.title}
              onChange={(e) => setBasics((f) => ({ ...f, title: e.target.value }))}
              placeholder="Title *"
              className="w-full bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground"
            />
            <div className="flex flex-wrap gap-2">
              <select
                value={basics.testKind}
                onChange={(e) =>
                  setBasics((f) => ({ ...f, testKind: e.target.value as TestKind }))
                }
                className="bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground"
              >
                {TEST_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {TEST_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <input
                value={basics.durationMin}
                onChange={(e) => setBasics((f) => ({ ...f, durationMin: e.target.value }))}
                placeholder="Duration (min)"
                className="bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground w-28"
              />
              <input
                value={basics.maxMarks}
                onChange={(e) => setBasics((f) => ({ ...f, maxMarks: e.target.value }))}
                placeholder="Max marks"
                className="bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground w-24"
              />
            </div>
            {/* The denominator every mark on this test is scored against. For a
                built paper it is the sum of the question marks and this field
                is ignored — saying so beats letting a teacher type 20 over a
                10-mark paper and watch every mark come out of 20. */}
            <div className="text-[10px] text-muted-foreground">
              Max marks is taken from the questions you add. This field is only used for an
              uploaded paper.
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                value={basics.chapter}
                onChange={(e) => setBasics((f) => ({ ...f, chapter: e.target.value }))}
                placeholder="Chapter"
                className="bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground flex-1 min-w-[140px]"
              />
              <input
                value={basics.topic}
                onChange={(e) => setBasics((f) => ({ ...f, topic: e.target.value }))}
                placeholder="Topic"
                className="bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground flex-1 min-w-[140px]"
              />
            </div>
            {/* §10.22: a test carries its topic per question, and the report
                ranks weak topics off it. Questions from the bank bring their
                own; hand-written ones take these two. */}
            <div className="text-[10px] text-muted-foreground">
              The chapter and topic are what the class report ranks weak topics by. Questions taken
              from the bank bring their own.
            </div>
            <textarea
              value={basics.instructions}
              onChange={(e) => setBasics((f) => ({ ...f, instructions: e.target.value }))}
              placeholder="Instructions"
              className="w-full bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground min-h-[60px]"
            />
            <div className="flex flex-wrap gap-1">
              {(
                [
                  { key: "draft" as const, label: "Save as draft" },
                  { key: "schedule" as const, label: "Schedule" },
                  { key: "now" as const, label: "Publish now" },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setBasics((f) => ({ ...f, publishMode: m.key }))}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${
                    basics.publishMode === m.key
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {basics.publishMode === "schedule" && (
              <input
                type="datetime-local"
                value={basics.scheduledAt}
                onChange={(e) => setBasics((f) => ({ ...f, scheduledAt: e.target.value }))}
                className="bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground"
              />
            )}
            <button
              type="button"
              onClick={goFromBasics}
              className="flex items-center gap-2 px-4 py-2 rounded-[2px] text-xs font-bold text-primary-foreground bg-primary"
            >
              Next: Choose source <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {step === "source" && (
          <div className="space-y-3">
            <div className="text-sm font-bold text-foreground">How will you add questions?</div>
            {(
              [
                {
                  key: "library" as const,
                  icon: BookOpen,
                  title: "Pick from the question bank",
                  desc: "21,000+ board MCQs, by chapter and difficulty — answers already keyed",
                },
                {
                  key: "manual" as const,
                  icon: PenLine,
                  title: "Write the questions yourself",
                  desc: "Multiple choice or True / False, marked automatically",
                },
                {
                  key: "upload" as const,
                  icon: Upload,
                  title: "Upload a written paper",
                  desc: "Attach a PDF for a paper sat in class — saves as a draft, no online attempt",
                },
              ] as const
            ).map((card) => (
              <button
                key={card.key}
                type="button"
                onClick={() => pickSource(card.key)}
                className="w-full text-left p-4 bg-surface border border-border rounded-[2px] hover:border-primary/50 transition-all flex gap-3"
              >
                <card.icon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-foreground">{card.title}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{card.desc}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {step === "library" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
              <span>
                On this paper: <strong className="text-foreground">{questions.length}</strong>
              </span>
              <span>
                Marks: <strong className="text-foreground">{questionMarksTotal}</strong>
              </span>
              <span>
                Subject: <strong className="text-foreground">{subject || "—"}</strong>
              </span>
            </div>

            <div className="bg-surface border border-border rounded-[2px] p-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                <select
                  value={bankClassLevel}
                  onChange={(e) => {
                    setBankClassLevel(e.target.value);
                    setBankChapter("");
                  }}
                  className="bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground"
                >
                  <option value="">Class level *</option>
                  {[5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                    <option key={n} value={String(n)}>
                      Class {n}
                    </option>
                  ))}
                </select>
                <select
                  value={bankChapter}
                  onChange={(e) => setBankChapter(e.target.value)}
                  disabled={bankChapters.length === 0}
                  className="bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground disabled:opacity-50 max-w-[220px]"
                >
                  <option value="">All chapters</option>
                  {bankChapters.map((c) => (
                    <option key={c.chapter} value={c.chapter}>
                      {c.chapter} ({c.count})
                    </option>
                  ))}
                </select>
                <select
                  value={bankDifficulty}
                  onChange={(e) => setBankDifficulty(e.target.value)}
                  className="bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground capitalize"
                >
                  <option value="">Any difficulty</option>
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <input
                  value={bankSearch}
                  onChange={(e) => setBankSearch(e.target.value)}
                  placeholder="Search the question text"
                  className="flex-1 bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground"
                />
              </div>
              {/* The class level is required, not defaulted: guessing it would
                  serve a Class 6 paper to a Class 10 section, and the bank
                  holds every level. */}
              {!bankClassLevel && (
                <div className="text-[10px] text-muted-foreground">
                  Choose the class level to search. The subject is this class&apos;s own
                  {subject ? ` (${subject})` : ""}.
                </div>
              )}
            </div>

            {bankError && (
              <div className="rounded-[2px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                {bankError}
              </div>
            )}

            {bankLoading ? (
              <Loading label="Searching the question bank…" />
            ) : bankItems.length > 0 ? (
              <div className="space-y-2">
                {bankItems.map((item) => {
                  const already = questions.some((q) => q.bankId === item.id);
                  return (
                    <div
                      key={item.id}
                      className="p-3 bg-surface border border-border/70 rounded-[2px] space-y-2"
                    >
                      <div className="text-xs text-foreground">{item.question}</div>
                      <div className="grid grid-cols-2 gap-1">
                        {item.options.map((opt, i) => (
                          <div
                            key={i}
                            className={cn(
                              "text-[10px] px-2 py-1 rounded-[2px] border",
                              i === item.correctIndex
                                ? "border-success/40 bg-success/10 text-success"
                                : "border-border/60 text-muted-foreground",
                            )}
                          >
                            {String.fromCharCode(65 + i)}. {opt}
                            {i === item.correctIndex ? " ✓" : ""}
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[9px] text-muted-foreground truncate">
                          {[item.chapter, item.topic ? displayTopic(item.topic) || item.topic : null, item.difficulty]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                        <button
                          type="button"
                          disabled={already}
                          onClick={() => addBankQuestion(item)}
                          className="px-2 py-1 rounded-lg text-[10px] font-bold bg-primary/20 text-primary disabled:opacity-40 shrink-0"
                        >
                          {already ? "On the paper" : "Add"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-surface border border-dashed border-border rounded-[2px] p-6 text-center space-y-2">
                <BookOpen className="w-8 h-8 text-muted-foreground mx-auto" />
                <div className="text-xs text-muted-foreground">
                  {!bankClassLevel
                    ? "Choose a class level to see the bank's questions for this subject."
                    : "No approved questions match those filters for this subject and class."}
                </div>
              </div>
            )}

            {questions.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border/60">
                <div className="text-[10px] font-bold text-foreground">
                  On this paper ({questions.length})
                </div>
                {questions.map((q, i) => (
                  <div
                    key={q.localId}
                    className="p-2 bg-muted/40 border border-border/60 rounded-[2px] flex items-center gap-2"
                  >
                    <span className="text-[9px] text-muted-foreground shrink-0">{i + 1}.</span>
                    <span className="text-[11px] text-foreground flex-1 min-w-0 truncate">
                      {q.question}
                    </span>
                    <span className="text-[9px] text-muted-foreground shrink-0">
                      {q.marks ?? 1} mark{(q.marks ?? 1) === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQuestions((prev) => prev.filter((x) => x.localId !== q.localId))}
                      className="p-1 rounded bg-destructive/15 text-destructive shrink-0"
                      aria-label={`Remove question ${i + 1}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setStep("review")}
                  className="flex items-center gap-2 px-4 py-2 rounded-[2px] text-xs font-bold text-primary-foreground bg-primary"
                >
                  Next: Review <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {step === "manual" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
              <span>
                Total questions:{" "}
                <strong className="text-foreground">{questions.length}</strong>
              </span>
              <span>
                Total marks:{" "}
                <strong className="text-foreground">{questionMarksTotal}</strong>
              </span>
              <span>
                Duration: <strong className="text-foreground">{durationMin} min</strong>
              </span>
            </div>

            <div className="bg-surface border border-border rounded-[2px] p-4 space-y-2">
              {/* Two presets, and both are MCQs: an online test is marked by
                  comparing the answer to its key, and nothing in the product
                  marks prose. A written question belongs on a printed paper
                  (/teacher/question-papers). */}
              <div className="flex gap-1">
                {QUESTION_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() =>
                      setQForm((f) => ({
                        ...f,
                        preset: preset.value,
                        options: [...preset.options],
                        correctIndex: null,
                      }))
                    }
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[10px] font-bold",
                      qForm.preset === preset.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <textarea
                value={qForm.question}
                onChange={(e) => setQForm((f) => ({ ...f, question: e.target.value }))}
                placeholder="Question text *"
                className="w-full bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground min-h-[50px]"
              />

              {/* The correct answer is PICKED, never typed. It used to be a
                  free-text "Correct option text" field: a typo produced an
                  answer key naming no option, and then every student's answer
                  marked wrong with nothing on screen to explain it. */}
              <div className="space-y-1.5">
                <div className="text-[10px] text-muted-foreground">
                  Options — tap the circle to mark the correct one
                </div>
                {qForm.options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setQForm((f) => ({ ...f, correctIndex: i }))}
                      aria-label={`Mark option ${String.fromCharCode(65 + i)} correct`}
                      aria-pressed={qForm.correctIndex === i}
                      className={cn(
                        "w-6 h-6 rounded-full border text-[10px] font-bold shrink-0 flex items-center justify-center",
                        qForm.correctIndex === i
                          ? "border-success bg-success/20 text-success"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {String.fromCharCode(65 + i)}
                    </button>
                    <input
                      value={opt}
                      onChange={(e) =>
                        setQForm((f) => ({
                          ...f,
                          options: f.options.map((o, j) => (j === i ? e.target.value : o)),
                        }))
                      }
                      disabled={qForm.preset === "true_false"}
                      placeholder={`Option ${String.fromCharCode(65 + i)}`}
                      className="flex-1 bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground disabled:opacity-70"
                    />
                    {qForm.preset === "mcq" && qForm.options.length > 2 && (
                      <button
                        type="button"
                        onClick={() =>
                          setQForm((f) => ({
                            ...f,
                            options: f.options.filter((_, j) => j !== i),
                            correctIndex:
                              f.correctIndex == null
                                ? null
                                : f.correctIndex === i
                                  ? null
                                  : f.correctIndex > i
                                    ? f.correctIndex - 1
                                    : f.correctIndex,
                          }))
                        }
                        className="p-1 rounded bg-destructive/15 text-destructive shrink-0"
                        aria-label={`Remove option ${String.fromCharCode(65 + i)}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
                {qForm.preset === "mcq" && qForm.options.length < 6 && (
                  <button
                    type="button"
                    onClick={() => setQForm((f) => ({ ...f, options: [...f.options, ""] }))}
                    className="text-[10px] font-bold text-primary"
                  >
                    + Add another option
                  </button>
                )}
              </div>

              <input
                value={qForm.explanation}
                onChange={(e) => setQForm((f) => ({ ...f, explanation: e.target.value }))}
                placeholder="Explanation (shown to the student with their result)"
                className="w-full bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground"
              />

              <div className="flex gap-2">
                <input
                  value={qForm.marks}
                  inputMode="numeric"
                  onChange={(e) => setQForm((f) => ({ ...f, marks: e.target.value }))}
                  placeholder="Marks"
                  className="bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground w-24"
                />
                <button
                  type="button"
                  onClick={addManualQuestion}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-[10px] font-bold bg-primary/20 text-primary"
                >
                  <Plus className="w-3 h-3" /> Add question
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {questions.map((q, i) => (
                <div
                  key={q.localId}
                  className="p-3 bg-surface border border-border/70 rounded-[2px] flex gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[9px] text-primary font-bold uppercase">
                      {q.marks ?? 1} mark{(q.marks ?? 1) === 1 ? "" : "s"}
                      {q.bankId ? " · from the bank" : ""}
                    </div>
                    <div className="text-xs text-foreground mt-0.5 line-clamp-2">{q.question}</div>
                    {/* The key, on screen, as the option it names. This is the
                        only place a teacher can check it before publishing. */}
                    <div className="text-[9px] text-success mt-0.5 truncate">
                      Correct: {String.fromCharCode(65 + q.correctIndex)}. {q.options[q.correctIndex]}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => moveQuestion(i, -1)}
                      className="p-1 rounded bg-muted text-muted-foreground disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={i === questions.length - 1}
                      onClick={() => moveQuestion(i, 1)}
                      className="p-1 rounded bg-muted text-muted-foreground disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setQuestions((prev) => prev.filter((x) => x.localId !== q.localId))
                      }
                      className="p-1 rounded bg-destructive/15 text-destructive"
                      aria-label="Remove question"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
              {questions.length === 0 && (
                <div className="text-[10px] text-muted-foreground text-center py-4">
                  No questions added yet.
                </div>
              )}
            </div>

            {editQuestionsFor ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveEditedQuestions()}
                className="flex items-center gap-2 px-4 py-2 rounded-[2px] text-xs font-bold text-primary-foreground bg-primary disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save questions
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (questions.length === 0) {
                    setError("Add at least one question before review");
                    return;
                  }
                  setError(null);
                  setStep("review");
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-[2px] text-xs font-bold text-primary-foreground bg-primary"
              >
                Next: Review <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {step === "upload" && (
          <div className="space-y-3">
            <div className="bg-surface border border-border rounded-[2px] p-4 space-y-2">
              <div className="text-[10px] font-bold text-foreground">Upload question paper</div>
              <div className="text-[10px] text-muted-foreground">
                PDF, images, Word, Excel, PowerPoint, or links — same upload experience as Homework.
              </div>
              <AttachmentComposer items={attachments} onChange={setAttachments} disabled={saving} />
            </div>
            <button
              type="button"
              onClick={() => {
                if (attachments.length === 0) {
                  setError("Add at least one attachment before review");
                  return;
                }
                setError(null);
                setStep("review");
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-[2px] text-xs font-bold text-primary-foreground bg-primary"
            >
              Next: Review <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            <div className="bg-surface border border-border rounded-[2px] p-4 space-y-2 text-xs">
              <div className="text-sm font-bold text-foreground">{basics.title || "Untitled"}</div>
              <div className="text-muted-foreground">
                {TEST_KIND_LABELS[basics.testKind]} · {durationMin} min
                {basics.maxMarks ? ` · max ${basics.maxMarks}` : ""}
                {source === "manual" ? ` · ${questions.length} questions · ${questionMarksTotal} marks` : ""}
                {source === "upload" ? ` · ${attachments.length} attachment(s)` : ""}
              </div>
              {basics.instructions && (
                <div className="text-[10px] text-muted-foreground pt-1 border-t border-border">
                  {basics.instructions}
                </div>
              )}
              <div className="text-[10px] text-muted-foreground">
                Source:{" "}
                {source === "manual"
                  ? "Manual questions"
                  : source === "upload"
                    ? "Uploaded paper"
                    : "Library"}{" "}
                · Preferred:{" "}
                {basics.publishMode === "now"
                  ? "Publish now"
                  : basics.publishMode === "schedule"
                    ? "Schedule"
                    : "Draft"}
              </div>
              {source === "upload" && attachments.length > 0 && (
                <AttachmentList items={attachments} dense />
              )}
              {source === "upload" && (
                <div className="text-[10px] text-warning">
                  This paper has no online questions, so students will see it as a written paper and
                  cannot sit it in the app. Enter their marks yourself once it is written.
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitBuilder("draft")}
                className="flex items-center gap-1.5 px-4 py-2 rounded-[2px] text-xs font-bold bg-muted/80 text-foreground disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save draft
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitBuilder("schedule")}
                className="flex items-center gap-1.5 px-4 py-2 rounded-[2px] text-xs font-bold bg-primary/25 text-primary disabled:opacity-50"
              >
                Schedule
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitBuilder("now")}
                className="flex items-center gap-1.5 px-4 py-2 rounded-[2px] text-xs font-bold bg-primary text-primary-foreground disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Publish
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-foreground">Tests</div>
        <button
          type="button"
          onClick={openBuilder}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] text-[10px] font-bold bg-primary/15 text-primary"
        >
          <Plus className="w-3 h-3" /> Create Test
        </button>
      </div>
      {error && (
        <div className="rounded-[2px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-[2px] border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          {success}
        </div>
      )}

      <div className="text-[10px] text-muted-foreground">{tests.length} tests</div>
      <div className="space-y-2">
        {tests.map((t) => {
          const status = resolveTestStatus(t);
          const marks = t.max_mark ?? t.total_marks;
          const qCount = t.question_count;
          const canPublish = status !== "published" && status !== "archived";
          // A published test with no questions is one a student would be
          // offered and then refused by `rpc_test_start` — EXCEPT when it is an
          // uploaded written paper, which has no online questions by design and
          // whose card tells the student exactly that.
          //
          // The attachment marker is read out of `instructions` because that is
          // where `TestService.create` puts it ("[Paper attachments]"), and a
          // sniff of the real storage beats a second column holding the same
          // fact (G9). If attachments ever get their own column, this reads it
          // instead and nothing else moves.
          const isPaperUpload = String(t.instructions ?? "").includes("[Paper attachments]");
          const publishedEmpty = status === "published" && qCount === 0 && !isPaperUpload;
          return (
            <div key={t.id} className="p-3 bg-surface border border-border/70 rounded-[2px] space-y-2">
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-foreground truncate">{t.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {TEST_KIND_LABELS[(t.test_kind as TestKind) ?? "class_test"] ?? t.test_kind} ·{" "}
                    {qCount} Q · {marks != null ? `${marks} marks` : "— marks"}
                    {t.duration_sec ? ` · ${Math.round(t.duration_sec / 60)} min` : ""}
                    {t.subject ? ` · ${displaySubject(t.subject)}` : ""}
                  </div>
                  {/* How many have handed in — the fact a teacher opens a
                      published test to find out, and one this list could not
                      state at all before `rpc_test_list_for_class`. */}
                  {status === "published" && t.submitted_count != null && (
                    <div className="text-[10px] text-primary font-bold mt-0.5">
                      {t.submitted_count} of {t.roll_count ?? "—"} handed in
                    </div>
                  )}
                  {publishedEmpty && (
                    <div className="text-[10px] text-destructive mt-0.5">
                      Published with no questions — students cannot sit it. Add questions or archive it.
                    </div>
                  )}
                </div>
                <span
                  className={cn(
                    "text-[9px] font-bold px-2 py-1 rounded-lg h-fit capitalize shrink-0",
                    status === "published"
                      ? "bg-success/15 text-success"
                      : status === "scheduled"
                        ? "bg-primary/15 text-primary"
                        : status === "archived"
                          ? "bg-secondary text-secondary-foreground"
                          : "bg-muted/80 text-muted-foreground",
                  )}
                >
                  {status}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {ctx && (
                  <button
                    type="button"
                    onClick={() => void openReport(t.id)}
                    aria-expanded={reportTestId === t.id}
                    className={cn(
                      "px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1",
                      reportTestId === t.id
                        ? "bg-info text-foreground"
                        : "bg-info/20 text-info",
                    )}
                  >
                    <BarChart3 className="w-3 h-3" /> Report
                  </button>
                )}
                {ctx && canPublish && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void runAction("Publish", () => TestService.publish(ctx, t.id))}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-primary/20 text-primary flex items-center gap-1 disabled:opacity-50"
                  >
                    <Send className="w-3 h-3" /> Publish
                  </button>
                )}
                {ctx && (status === "draft" || status === "scheduled") && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setScheduleDraftId(t.id);
                      setScheduleAt("");
                      setError(null);
                    }}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-primary/20 text-primary disabled:opacity-50"
                  >
                    Schedule
                  </button>
                )}
                {ctx && status !== "archived" && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setEditId(t.id);
                      setEditTitle(String(t.title ?? ""));
                      setEditInstructions("");
                      setError(null);
                    }}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted/80 text-muted-foreground disabled:opacity-50"
                  >
                    Edit
                  </button>
                )}
                {ctx && status !== "archived" && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void openQuestionEditor(t)}
                    title={
                      (t.submitted_count ?? 0) > 0
                        ? "Students have handed this in — its questions are fixed now"
                        : "Add, remove or correct the questions"
                    }
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted/80 text-muted-foreground disabled:opacity-50"
                  >
                    Edit questions
                  </button>
                )}
                {ctx && status !== "archived" && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void runAction("Archive", () => TestService.archive(ctx, t.id))}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted text-warning flex items-center gap-1 disabled:opacity-50"
                  >
                    <Archive className="w-3 h-3" /> Archive
                  </button>
                )}
                {ctx && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      if (!window.confirm(`Delete “${t.title ?? "this test"}”?`)) return;
                      void runAction("Delete", () => TestService.remove(ctx, t.id));
                    }}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-destructive/15 text-destructive flex items-center gap-1 disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                )}
              </div>
              {scheduleDraftId === t.id && ctx && (
                <div className="flex flex-wrap gap-2 items-center pt-1">
                  <input
                    type="datetime-local"
                    value={scheduleAt}
                    onChange={(e) => setScheduleAt(e.target.value)}
                    className="bg-muted border border-border rounded-[2px] px-3 py-1.5 text-[11px] text-foreground"
                  />
                  <button
                    type="button"
                    disabled={saving || !scheduleAt}
                    onClick={() =>
                      void runAction("Schedule", async () => {
                        await TestService.schedule(ctx, t.id, new Date(scheduleAt).toISOString());
                        setScheduleDraftId(null);
                      })
                    }
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-primary text-primary-foreground disabled:opacity-50"
                  >
                    Confirm schedule
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleDraftId(null)}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {editId === t.id && ctx && (
                <div className="space-y-2 pt-1">
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Title"
                    className="w-full bg-muted border border-border rounded-[2px] px-3 py-1.5 text-[11px] text-foreground"
                  />
                  <textarea
                    value={editInstructions}
                    onChange={(e) => setEditInstructions(e.target.value)}
                    placeholder="Update instructions (optional)"
                    className="w-full bg-muted border border-border rounded-[2px] px-3 py-1.5 text-[11px] text-foreground min-h-[50px]"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={saving || !editTitle.trim()}
                      onClick={() =>
                        void runAction("Update", async () => {
                          await TestService.update(ctx, t.id, {
                            title: editTitle.trim(),
                            ...(editInstructions.trim()
                              ? { instructions: editInstructions.trim() }
                              : {}),
                          });
                          setEditId(null);
                        })
                      }
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-primary text-primary-foreground disabled:opacity-50"
                    >
                      Save changes
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditId(null)}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {reportTestId === t.id && (
                <div className="pt-2 mt-1 border-t border-border/60 space-y-3">
                  {reportLoading && <Loading label="Loading report" />}
                  {reportError && (
                    <div className="rounded-[2px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                      {reportError}
                    </div>
                  )}
                  {report && (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-[2px] bg-muted/60 px-2 py-1.5">
                          <div className="text-[9px] text-muted-foreground">Submitted</div>
                          <div className="text-xs font-bold text-foreground">
                            {toCountLabel(report.submitted_count)} of{" "}
                            {report.students.length}
                          </div>
                        </div>
                        <div className="rounded-[2px] bg-muted/60 px-2 py-1.5">
                          <div className="text-[9px] text-muted-foreground">Class average</div>
                          {/* NULL, not 0, when nobody has sat it — the database
                              is deliberate about that and the screen must be
                              too: a real class average of 0 is a different
                              fact from an unsat test. */}
                          <div className="text-xs font-bold text-foreground">
                            {toCountLabel(report.class_average)}
                            {report.class_average != null && report.max_mark != null
                              ? ` / ${report.max_mark}`
                              : ""}
                          </div>
                        </div>
                        <div className="rounded-[2px] bg-muted/60 px-2 py-1.5">
                          <div className="text-[9px] text-muted-foreground">Avg per question</div>
                          <div className="text-xs font-bold text-foreground">
                            {report.average_seconds_per_question == null
                              ? toCountLabel(null)
                              : `${report.average_seconds_per_question}s`}
                          </div>
                        </div>
                      </div>

                      {report.submitted_count === 0 && (
                        <div className="text-[10px] text-muted-foreground">
                          Nobody has submitted this test yet, so there is no average and no
                          topic ranking to show.
                        </div>
                      )}

                      {report.weakest_topics.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-[10px] font-bold text-foreground">
                            Weakest topics
                          </div>
                          {report.weakest_topics.map((w) => (
                            <div
                              key={w.topic}
                              className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1"
                            >
                              <span className="text-[10px] text-foreground truncate">
                                {displayTopic(w.topic) || w.topic}
                              </span>
                              <span className="text-[9px] text-destructive shrink-0">
                                {w.wrong} of {w.asked} wrong · {toPercentLabel(w.wrong_pct)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] font-bold text-foreground">Class list</div>
                        <button
                          type="button"
                          onClick={() => exportCSV(`test-report-${report.test_id}`, classReportCsvRows(report))}
                          className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted text-muted-foreground flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" /> CSV
                        </button>
                      </div>

                      <div className="space-y-1">
                        {report.students.map((s) => (
                          <div key={s.student_id}>
                            <button
                              type="button"
                              onClick={() => void openDrill(t.id, s.student_id)}
                              aria-expanded={drillStudentId === s.student_id}
                              className="w-full flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1 text-left"
                            >
                              <span className="text-[10px] text-foreground truncate">
                                {s.roll_number != null && s.roll_number !== ""
                                  ? `${s.roll_number}. `
                                  : ""}
                                {toPersonName(s.full_name, { kind: "student" })}
                              </span>
                              <span className="text-[9px] text-muted-foreground shrink-0">
                                {s.submitted
                                  ? `${toCountLabel(s.mark)}${report.max_mark != null ? ` / ${report.max_mark}` : ""}`
                                  : "Not submitted"}
                              </span>
                            </button>
                            {drillStudentId === s.student_id && (
                              <div className="mt-1 ml-2 rounded-[2px] border border-border/60 bg-muted/20 px-2 py-2 space-y-2">
                                {drillLoading && <Loading label="Loading" />}
                                {drillError && (
                                  <div className="text-[10px] text-destructive">{drillError}</div>
                                )}
                                {/* Three different empty states, because they
                                    are three different facts. Rendering them
                                    the same is the defect this whole report
                                    was almost shipped with. */}
                                {drill && !drill.submitted && (
                                  <div className="text-[10px] text-muted-foreground">
                                    This student did not sit the test, so there is nothing to
                                    review.
                                  </div>
                                )}
                                {drill && drill.submitted && drill.wrong_answers.length === 0 && (
                                  <div className="text-[10px] text-muted-foreground">
                                    Nothing went wrong — every question was correct.
                                  </div>
                                )}
                                {drill && drill.submitted && drill.wrong_answers.length > 0 && (
                                  <>
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="text-[10px] font-bold text-foreground">
                                        {drill.wrong_answers.length} to review
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          exportCSV(
                                            `test-report-${drill.test_id}-${drill.student_id}`,
                                            studentReportCsvRows(drill),
                                          )
                                        }
                                        className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted text-muted-foreground flex items-center gap-1"
                                      >
                                        <Download className="w-3 h-3" /> CSV
                                      </button>
                                    </div>
                                    {drill.wrong_answers.map((w) => {
                                      const theirs = answerToText(w.their_answer, w.options);
                                      const right = answerToText(w.correct_answer, w.options);
                                      return (
                                        <div
                                          key={w.question_id}
                                          className="rounded-lg bg-surface border border-border/60 px-2 py-1.5 space-y-0.5"
                                        >
                                          <div className="text-[10px] text-foreground">
                                            {toDisplayText(w.question, { fallback: "Question" })}
                                          </div>
                                          <div className="text-[9px] text-muted-foreground">
                                            {displayTopic(w.topic) || w.topic}
                                            {w.marks != null ? ` · ${w.marks} marks` : ""}
                                          </div>
                                          <div className="text-[9px]">
                                            <span className="text-destructive">
                                              {!w.answered
                                                ? "Left blank"
                                                : theirs != null
                                                  ? `Answered: ${theirs}`
                                                  : "Their answer was recorded in a form this screen cannot read"}
                                            </span>
                                            {right != null && (
                                              <span className="text-success">
                                                {" "}
                                                · Correct: {right}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                        {report.students.length === 0 && (
                          <div className="text-[10px] text-muted-foreground">
                            This class has no students on roll.
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {tests.length === 0 && <div className="text-xs text-muted-foreground">No tests yet.</div>}
      </div>
    </div>
  );
}

export function LiveExamsMarksTab({
  classId,
  subject,
  isClassTeacher = false,
}: {
  classId: string;
  subject: string;
  isClassTeacher?: boolean;
}) {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["marks", "examination", "profile"]);
  // A sitting (§10.22): one exam covering one or more subjects. What used to
  // be a client-side grouping of sibling exam rows is now the exam row itself.
  type ExamSitting = Awaited<ReturnType<typeof MarksService.listExamSittingsForClass>>[number];
  type PendingSubject = Awaited<ReturnType<typeof MarksService.listMyPendingSubjectExams>>[number];

  const [groups, setGroups] = useState<ExamSitting[]>([]);
  const [pending, setPending] = useState<PendingSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    startDate: "",
    endDate: "",
    instructions: "",
    examType: "unit_test",
    defaultMaxMarks: "100",
  });
  // Marks are entered for one SUBJECT of one sitting, so the open marks sheet
  // has to carry both — the sitting for max marks and lock state, the subject
  // for the anchor every mark is written against.
  const [activeSubject, setActiveSubject] = useState<PendingSubject | null>(null);
  /**
   * KNOWN_ISSUES 20. saveMarks() finishes with two awaits AFTER it has already
   * shown "Marks saved", then calls setActiveSubject(refreshed). A teacher who
   * clicks "Back to exams" in that window was silently pulled back into the
   * marks sheet — the write had landed, but the app looked stuck. State cannot
   * be read from a closure that was created before the awaits, so the open
   * sheet is mirrored here and the tail checks it before re-opening anything.
   */
  const activeSubjectRef = useRef<PendingSubject | null>(null);
  useEffect(() => {
    activeSubjectRef.current = activeSubject;
  }, [activeSubject]);
  const [activeSitting, setActiveSitting] = useState<ExamSitting | null>(null);
  const [roster, setRoster] = useState<ClassStudentRow[]>([]);
  const [marksDraft, setMarksDraft] = useState<Record<string, string>>({});
  const [marksLoading, setMarksLoading] = useState(false);
  const [canEditActive, setCanEditActive] = useState(false);

  const reload = async () => {
    if (!ctx) return;
    const quiet = loadedRef.current;
    if (!quiet) setLoading(true);
    try {
      const [g, p] = await Promise.all([
        MarksService.listExamSittingsForClass(ctx, classId),
        MarksService.listMyPendingSubjectExams(ctx, classId),
      ]);
      setGroups(g);
      setPending(p);
      setError(null);
      loadedRef.current = true;
    } catch (e) {
      setError(toErrorMessage(e, "Failed to load exams"));
    } finally {
      setLoading(false);
    }
  };

  useResetOnIdentityChange(loadedRef, classId);
  useEffect(() => {
    if (!ready || !ctx) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx, classId]);

  useEffect(() => {
    if (!ready || !ctx || !loadedRef.current) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVersion]);

  const showFlash = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2800);
  };

  const createClassExam = async () => {
    if (!ctx || !form.name.trim() || !form.startDate) {
      setError("Exam name and start date are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await MarksService.createClassExam(ctx, {
        classId,
        name: form.name.trim(),
        startDate: form.startDate,
        endDate: form.endDate || form.startDate,
        instructions: form.instructions || null,
        examType: form.examType,
        defaultMaxMarks: Number(form.defaultMaxMarks) || 100,
      });
      setForm({
        name: "",
        startDate: "",
        endDate: "",
        instructions: "",
        examType: "unit_test",
        defaultMaxMarks: "100",
      });
      setCreating(false);
      showFlash("Exam created for all class subjects");
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, "Failed to create exam"));
    } finally {
      setSaving(false);
    }
  };

  const openMarks = async (item: PendingSubject, editable: boolean) => {
    if (!ctx) return;
    const { exam } = item;
    setActiveSubject(item);
    setActiveSitting(null);
    setCanEditActive(editable && !exam.marksLocked && !exam.resultsPublishedAt);
    setMarksLoading(true);
    setError(null);
    try {
      const [students, existing] = await Promise.all([
        AttendanceService.listClassStudents(ctx, classId),
        MarksService.listForExam(ctx, exam.id),
      ]);
      setRoster(students);
      const draft: Record<string, string> = {};
      for (const m of existing) {
        draft[m.studentId] = String(m.marksObtained);
      }
      setMarksDraft(draft);
    } catch (e) {
      setError(toErrorMessage(e, "Failed to load marks entry"));
    } finally {
      setMarksLoading(false);
    }
  };

  const openSittingReview = (g: ExamSitting) => {
    setActiveSitting(g);
    setActiveSubject(null);
  };

  const saveMarks = async () => {
    if (!ctx || !activeSubject || !canEditActive) return;
    const { exam, subject } = activeSubject;
    const rows = Object.entries(marksDraft)
      .filter(([, v]) => v !== "" && !Number.isNaN(Number(v)))
      .map(([studentId, v]) => ({ studentId, marksObtained: Number(v) }));
    if (!rows.length) {
      setError("Enter at least one mark");
      return;
    }
    const outOfRange = rows.some((r) => r.marksObtained < 0 || r.marksObtained > exam.maxMarks);
    if (outOfRange) {
      setError(`Marks must be between 0 and ${exam.maxMarks} (this exam's max marks)`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Named subject, not inferred: a sitting covering several subjects has
      // no single answer, and writing the mark against the wrong one would
      // look identical to writing it against the right one.
      await MarksService.publishBatch(ctx, exam.id, rows, subject.examSubjectId);
      showFlash("Marks saved");
      await reload();
      const refreshed = await MarksService.getExam(ctx, exam.id);
      // Only re-open the sheet the user is STILL on. Without this the teacher
      // is yanked back to a screen they deliberately left.
      if (activeSubjectRef.current?.subject.examSubjectId === subject.examSubjectId) {
        setActiveSubject({ exam: refreshed, subject });
      }
    } catch (e) {
      setError(toErrorMessage(e, "Failed to save marks"));
    } finally {
      setSaving(false);
    }
  };

  const finalizeSitting = async (examId: string) => {
    if (!ctx) return;
    setSaving(true);
    setError(null);
    try {
      await MarksService.finalizeMarks(ctx, examId);
      showFlash("Exam finalized — marks locked");
      setActiveSitting(null);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, "Finalize failed"));
    } finally {
      setSaving(false);
    }
  };

  const publishSitting = async (examId: string) => {
    if (!ctx) return;
    setSaving(true);
    setError(null);
    try {
      await MarksService.publishResults(ctx, examId);
      showFlash("Results published to students & parents");
      setActiveSitting(null);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, "Publish results failed"));
    } finally {
      setSaving(false);
    }
  };

  /**
   * §10.5 gives the class teacher the exam for their own section. Being able to
   * create one and never remove it is a one-way door: a typo in the name or the
   * wrong section was permanent as far as the application was concerned.
   *
   * `MarksService.removeExam` already existed, already carried the right guard
   * (`assertTeacherMayManageAcademicWork`, which for a multi-subject sitting —
   * `subject` is NULL by construction — reduces to "do you own this class"),
   * and had ZERO callers anywhere in src/. This is the missing control, not a
   * new permission: `exams_delete` has always admitted the class teacher.
   *
   * The confirm names the marks explicitly because `deleteExam` removes them
   * with the sitting and nothing puts them back.
   */
  const deleteSitting = async (examId: string, name: string, subjectCount: number) => {
    if (!ctx) return;
    const subjects = `${subjectCount} subject${subjectCount === 1 ? "" : "s"}`;
    if (
      !window.confirm(
        `Delete "${name}"?\n\nIts ${subjects} and every mark already entered against it are deleted too. This cannot be undone.`,
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await MarksService.removeExam(ctx, examId);
      showFlash("Exam deleted");
      setActiveSitting(null);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, "Delete failed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label="Loading exams…" />;

  if (activeSubject) {
    const activeExam = activeSubject.exam;
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setActiveSubject(null)}
          className="text-[10px] font-bold text-primary"
        >
          â† Back to exams
        </button>
        {error && (
          <div className="rounded-[2px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {flash && (
          <div className="rounded-[2px] bg-success/15 text-success px-3 py-2 text-xs font-semibold">
            {flash}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-bold text-foreground">
            {activeExam.name} · {activeSubject.subject.subject}
          </div>
          {!canEditActive && (
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-muted/80 text-muted-foreground">
              Read Only
            </span>
          )}
          {activeExam.marksLocked && (
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-warning/20 text-warning flex items-center gap-1">
              <Lock className="w-3 h-3" /> Locked
            </span>
          )}
          {activeExam.resultsPublishedAt && (
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-success/20 text-success">
              Results published
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground">
          Max {activeExam.maxMarks}
          {activeExam.passingMarks != null ? ` · pass ${activeExam.passingMarks}` : ""}
        </div>

        {marksLoading ? (
          <Loading label="Loading roster…" />
        ) : (
          <div className="space-y-2">
            {roster.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 p-3 bg-surface border border-border/70 rounded-[2px]"
              >
                <div className="text-xs text-foreground min-w-0 truncate">
                  {s.rollNumber ? `#${s.rollNumber} · ` : ""}
                  {s.fullName}
                </div>
                <input
                  type="number"
                  disabled={!canEditActive || saving}
                  value={marksDraft[s.id] ?? ""}
                  onChange={(e) =>
                    setMarksDraft((d) => ({ ...d, [s.id]: e.target.value }))
                  }
                  className="bg-muted border border-border rounded-lg px-2 py-1 text-[11px] text-foreground w-24 disabled:opacity-50"
                />
              </div>
            ))}
            {roster.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-8">No students in this class.</div>
            )}
          </div>
        )}

        {canEditActive && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveMarks()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-[10px] font-bold bg-primary text-primary-foreground disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save marks
          </button>
        )}
      </div>
    );
  }

  if (activeSitting) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setActiveSitting(null)}
          className="text-[10px] font-bold text-primary"
        >
          â† Back to exams
        </button>
        {error && (
          <div className="rounded-[2px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {flash && (
          <div className="rounded-[2px] bg-success/15 text-success px-3 py-2 text-xs font-semibold">
            {flash}
          </div>
        )}
        <div className="text-sm font-bold text-foreground">{activeSitting.name}</div>
        <div className="text-[10px] text-muted-foreground">
          {activeSitting.startDate ?? "—"}
          {activeSitting.endDate && activeSitting.endDate !== activeSitting.startDate
            ? ` → ${activeSitting.endDate}`
            : ""}{" "}
          · {activeSitting.subjects.length} subjects
        </div>
        <div className="space-y-2">
          {activeSitting.subjects.map((s) => (
            <div
              key={s.examSubjectId}
              className="flex items-center justify-between gap-2 p-3 bg-surface border border-border/70 rounded-[2px]"
            >
              <div className="text-xs text-foreground font-semibold">{s.subject}</div>
              <div className="text-[10px] text-muted-foreground">
                {s.scheduledAt ? String(s.scheduledAt).slice(0, 10) : "—"}
              </div>
            </div>
          ))}
        </div>
        {isClassTeacher && !activeSitting.resultsPublishedAt && (
          <div className="flex flex-wrap gap-2">
            {/*
              Finalising acts on the SITTING, not on whichever subject happened
              to sort first. That is what makes "finalise one subject finalises
              its sitting" true by construction.
            */}
            <button
              type="button"
              disabled={saving || activeSitting.marksLocked}
              onClick={() => void finalizeSitting(activeSitting.examId)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-[10px] font-bold bg-warning/20 text-warning disabled:opacity-50"
            >
              <Lock className="w-3 h-3" /> Finalize all subjects
            </button>
            <button
              type="button"
              disabled={saving || !activeSitting.marksLocked}
              onClick={() => void publishSitting(activeSitting.examId)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-[10px] font-bold bg-success/20 text-success disabled:opacity-50"
            >
              <Unlock className="w-3 h-3" /> Publish Results
            </button>
          </div>
        )}
        {activeSitting.resultsPublishedAt && (
          <div className="text-[10px] text-success font-bold">Results published</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-foreground">Exams & Marks</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            One exam per class · subject teachers enter their own marks
          </div>
        </div>
        {isClassTeacher && (
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] text-[10px] font-bold bg-primary/15 text-primary"
          >
            <Plus className="w-3 h-3" /> New class exam
          </button>
        )}
      </div>
      {error && (
        <div className="rounded-[2px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {flash && (
        <div className="rounded-[2px] bg-success/15 text-success px-3 py-2 text-xs font-semibold">
          {flash}
        </div>
      )}

      {creating && isClassTeacher && (
        <div className="bg-surface border border-border rounded-[2px] p-4 space-y-2">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Exam name * e.g. Unit Test 1"
            className="w-full bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground"
          />
          <div className="flex flex-wrap gap-2">
            <label className="text-[10px] text-muted-foreground flex flex-col gap-1">
              Start date *
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                className="bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground"
              />
            </label>
            <label className="text-[10px] text-muted-foreground flex flex-col gap-1">
              End date
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                className="bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground"
              />
            </label>
            <label className="text-[10px] text-muted-foreground flex flex-col gap-1">
              Default max marks
              <input
                value={form.defaultMaxMarks}
                onChange={(e) => setForm((f) => ({ ...f, defaultMaxMarks: e.target.value }))}
                className="bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground w-24"
              />
            </label>
          </div>
          <textarea
            value={form.instructions}
            onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
            placeholder="Optional instructions"
            className="w-full bg-muted border border-border rounded-[2px] px-3 py-2 text-xs text-foreground min-h-[50px]"
          />
          <p className="text-[9px] text-muted-foreground">
            Subjects are loaded automatically from Teacher–Class–Subject mapping.
          </p>
          <button
            type="button"
            disabled={saving}
            onClick={() => void createClassExam()}
            className="flex items-center gap-2 px-4 py-2 rounded-[2px] text-xs font-bold text-primary-foreground bg-primary"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Create exam
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-foreground">Pending marks</div>
          {pending.map((p) => (
            <div
              key={p.subject.examSubjectId}
              className="flex items-center justify-between gap-2 p-3 bg-primary/10 border border-primary/25 rounded-[2px]"
            >
              <div>
                <div className="text-xs font-bold text-foreground">{p.exam.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {p.subject.subject} · max {p.exam.maxMarks}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void openMarks(p, true)}
                className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-primary text-primary-foreground"
              >
                Enter marks
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="text-[10px] text-muted-foreground">{groups.length} class exams</div>
      <div className="space-y-2">
        {groups.map((g) => {
          const mySubjects = g.subjects.filter(
            (s) =>
              pending.some((p) => p.subject.examSubjectId === s.examSubjectId) ||
              (subject && s.subject.toLowerCase() === subject.toLowerCase()),
          );
          return (
            <div key={g.examId} className="p-3 bg-surface border border-border/70 rounded-[2px] space-y-2">
              <div className="flex justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-foreground">{g.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {g.startDate ?? "—"}
                    {g.endDate && g.endDate !== g.startDate ? ` → ${g.endDate}` : ""} ·{" "}
                    {g.subjects.map((s) => s.subject).join(", ")}
                  </div>
                </div>
                <div className="flex flex-col gap-1 items-end">
                  {g.marksLocked && (
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-warning/20 text-warning">
                      Locked
                    </span>
                  )}
                  {g.resultsPublishedAt && (
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-success/20 text-success">
                      Published
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {mySubjects.map((s) => {
                  const known = pending.find(
                    (p) => p.subject.examSubjectId === s.examSubjectId,
                  );
                  return (
                    <button
                      key={s.examSubjectId}
                      type="button"
                      disabled={!known}
                      onClick={() =>
                        known && void openMarks(known, !g.marksLocked && !g.resultsPublishedAt)
                      }
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-primary/15 text-primary disabled:opacity-50"
                    >
                      {s.subject} marks
                    </button>
                  );
                })}
                {isClassTeacher && (
                  <button
                    type="button"
                    onClick={() => openSittingReview(g)}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted/80 text-muted-foreground"
                  >
                    Review / publish
                  </button>
                )}
                {isClassTeacher && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void deleteSitting(g.examId, g.name, g.subjects.length)}
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-destructive/15 text-destructive flex items-center gap-1 disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {groups.length === 0 && (
          <div className="text-xs text-muted-foreground">
            {isClassTeacher
              ? "No exams yet. Create a class exam — subjects are added automatically."
              : "No exams yet. The class teacher creates exams for this class."}
          </div>
        )}
      </div>
    </div>
  );
}

type InsightHwRow = Awaited<ReturnType<typeof HomeworkService.listForClassWithStats>>[number];
type InsightTestRow = {
  id: string;
  title?: string;
  subject?: string;
  status?: string;
  is_published?: boolean;
};
type DecisionRow = { id: string; name: string; metric: string; why: string };

function DecisionSection({
  title,
  question,
  rows,
  empty,
  metricClass = "text-destructive",
}: {
  title: string;
  question: string;
  rows: DecisionRow[];
  empty: string;
  metricClass?: string;
}) {
  return (
    <div className="bg-surface border border-border/70 rounded-[2px] p-4 space-y-2">
      <div>
        <div className="text-xs font-bold text-foreground">{title}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{question}</div>
      </div>
      {rows.length === 0 ? (
        <div className="text-[10px] text-muted-foreground py-1">{empty}</div>
      ) : (
        rows.map((r) => (
          <div
            key={r.id}
            className="flex justify-between gap-3 text-[11px] py-1.5 border-t border-border first:border-0"
          >
            <div className="min-w-0">
              <div className="text-foreground font-medium truncate">{r.name}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{r.why}</div>
            </div>
            <div className={cn("tabular-nums font-bold shrink-0 self-start", metricClass)}>
              {r.metric}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export function LiveInsightsTab({ classId }: { classId: string }) {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive([
    "attendance",
    "homework",
    "marks",
    "examination",
    "test",
    "profile",
    "xp",
  ]);
  const [analytics, setAnalytics] = useState<Awaited<
    ReturnType<typeof AnalyticsService.forClass>
  > | null>(null);
  const [profiles, setProfiles] = useState<StudentAcademicProfile[]>([]);
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  const [homework, setHomework] = useState<InsightHwRow[]>([]);
  const [tests, setTests] = useState<InsightTestRow[]>([]);
  const [exams, setExams] = useState<ExamRecord[]>([]);
  // A pending row is { exam, subject } — one per SUBJECT still awaiting
  // marks — not an ExamRecord. Typed as ExamRecord it compiled against the
  // wrong shape and the merge below read e.id off an object that has none.
  // Same derived-alias idiom this file already uses at listExamSittingsForClass.
  type PendingSubjectRow = Awaited<ReturnType<typeof MarksService.listMyPendingSubjectExams>>[number];
  const [pendingExams, setPendingExams] = useState<PendingSubjectRow[]>([]);
  const [progression, setProgression] = useState<TeacherProgressionInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  useResetOnIdentityChange(loadedRef, classId);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    const isFirst = !loadedRef.current;
    (async () => {
      if (isFirst) setLoading(true);
      try {
        const settled = await Promise.allSettled([
          AnalyticsService.forClass(ctx, classId),
          AcademicProfileService.listForClass(ctx, classId, { limit: 200 }),
          AttendanceService.listClassStudents(ctx, classId),
          HomeworkService.listForClassWithStats(ctx, classId, { limit: 100 }),
          TestService.listForClass(ctx, classId),
          MarksService.listExamsForClass(ctx, classId, { limit: 100 }),
          MarksService.listMyPendingSubjectExams(ctx, classId),
          ProgressionService.teacherClassInsights(ctx, classId),
        ]);
        if (cancelled) return;
        const a = settled[0].status === "fulfilled" ? settled[0].value : null;
        const p = settled[1].status === "fulfilled" ? settled[1].value : [];
        const students = settled[2].status === "fulfilled" ? settled[2].value : [];
        const hw = settled[3].status === "fulfilled" ? settled[3].value : [];
        const tRows =
          settled[4].status === "fulfilled"
            ? (settled[4].value as InsightTestRow[])
            : [];
        const examRows = settled[5].status === "fulfilled" ? settled[5].value : [];
        const pending = settled[6].status === "fulfilled" ? settled[6].value : [];
        const prog = settled[7].status === "fulfilled" ? settled[7].value : null;
        if (
          settled[0].status === "rejected" &&
          settled[1].status === "rejected" &&
          settled[2].status === "rejected"
        ) {
          throw new Error("Failed to load insights");
        }
        setAnalytics(a);
        setProfiles(p);
        setNameById(new Map(students.map((s) => [s.id, s.fullName])));
        setHomework(hw);
        setTests(tRows);
        setExams(examRows);
        setPendingExams(pending);
        setProgression(prog);
        const errs: string[] = [];
        if (settled[0].status === "rejected") errs.push(errMsg(settled[0].reason, "Analytics"));
        if (settled[1].status === "rejected") errs.push(errMsg(settled[1].reason, "Profiles"));
        if (settled[2].status === "rejected") errs.push(errMsg(settled[2].reason, "Roster"));
        if (settled[3].status === "rejected") errs.push(errMsg(settled[3].reason, "Homework"));
        if (settled[4].status === "rejected") errs.push(errMsg(settled[4].reason, "Tests"));
        if (settled[5].status === "rejected") errs.push(errMsg(settled[5].reason, "Exams"));
        if (settled[6].status === "rejected") errs.push(errMsg(settled[6].reason, "Pending marks"));
        if (settled[7].status === "rejected") errs.push(errMsg(settled[7].reason, "Progression"));
        setError(errs.length ? errs.join(" · ") : null);
        loadedRef.current = true;
      } catch (e) {
        if (!cancelled) setError(errMsg(e, "Failed to load insights"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, classId, liveVersion]);

  const displayName = (studentId: string) =>
    nameById.get(studentId) ?? "Unknown student";

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const activeHomework = useMemo(
    () =>
      homework.filter((h) => {
        if (h.archivedAt) return false;
        const st = String(h.status ?? "").toLowerCase();
        return st === "published" || st === "active";
      }),
    [homework],
  );

  const activeTests = useMemo(
    () =>
      tests.filter((t) => {
        const st = resolveTestStatus(t);
        return st === "published" || st === "active" || st === "live";
      }),
    [tests],
  );

  const upcomingExams = useMemo(
    () =>
      exams.filter(
        (e) => !e.resultsPublishedAt && e.examDate && e.examDate >= today,
      ),
    [exams, today],
  );

  const testsNeedingPublish = useMemo(
    () =>
      tests.filter((t) => {
        const st = resolveTestStatus(t);
        return st === "draft" || st === "scheduled";
      }),
    [tests],
  );

  const examsAwaitingMarks = useMemo(() => {
    const byId = new Map<string, ExamRecord>();
    for (const e of exams) {
      if (!e.marksLocked && !e.resultsPublishedAt) byId.set(e.id, e);
    }
    // Was: byId.set(e.id, e) — e.id is undefined on a { exam, subject } row,
    // so every pending subject overwrote a single entry keyed undefined and the
    // panel rendered one malformed row instead of the exams awaiting marks.
    // Several subjects of one exam collapse to that exam, which is what a list
    // of "exams awaiting marks" should show.
    for (const { exam } of pendingExams) byId.set(exam.id, exam);
    return [...byId.values()];
  }, [exams, pendingExams]);

  const lowCompletionHw = useMemo(
    () =>
      [...activeHomework]
        .sort((a, b) => a.completionPct - b.completionPct)
        .filter((h) => h.totalStudents > 0)
        .slice(0, 5),
    [activeHomework],
  );

  const lateHomework = useMemo(
    () =>
      [...activeHomework]
        .filter((h) => (h.late ?? 0) > 0)
        .sort((a, b) => (b.late ?? 0) - (a.late ?? 0))
        .slice(0, 5),
    [activeHomework],
  );

  const lowAttendance = useMemo(
    () =>
      profiles
        // attendanceTotal > 0 is not optional here. A student nobody has marked
        // carries attendancePct = 0, and without this guard they head a list
        // titled "low attendance" — the school-average defect at student level.
        // The "doing well" list below already guarded this way; the list that
        // names children as a problem did not.
        .filter((p) => p.attendanceTotal > 0 && p.attendancePct < ATTENDANCE_LOW)
        .sort((a, b) => a.attendancePct - b.attendancePct)
        .slice(0, 8),
    [profiles],
  );

  const pendingHwStudents = useMemo(
    () =>
      profiles
        .filter(
          (p) =>
            // homeworkAssigned > 0 on BOTH arms. The second arm already had it;
            // the first did not, so a student with nothing assigned carried
            // homeworkCompletionPct = 0 and appeared as pending work.
            p.homeworkAssigned > 0 &&
            (p.homeworkCompletionPct < HOMEWORK_LOW ||
              p.homeworkSubmitted < p.homeworkAssigned),
        )
        .sort((a, b) => a.homeworkCompletionPct - b.homeworkCompletionPct)
        .slice(0, 8),
    [profiles],
  );

  const lowAverages = useMemo(
    () =>
      profiles
        .filter(
          (p) =>
            (p.testsAvgPct > 0 && p.testsAvgPct < SUBJECT_AVERAGE_LOW) ||
            (p.examsAvgPct > 0 && p.examsAvgPct < SUBJECT_AVERAGE_LOW),
        )
        .sort(
          (a, b) =>
            Math.min(
              a.testsAvgPct > 0 ? a.testsAvgPct : 100,
              a.examsAvgPct > 0 ? a.examsAvgPct : 100,
            ) -
            Math.min(
              b.testsAvgPct > 0 ? b.testsAvgPct : 100,
              b.examsAvgPct > 0 ? b.examsAvgPct : 100,
            ),
        )
        .slice(0, 8),
    [profiles],
  );

  const needsAttentionRows = useMemo((): DecisionRow[] => {
    const rows: DecisionRow[] = [];
    const seen = new Set<string>();
    const push = (p: StudentAcademicProfile, metric: string, why: string) => {
      if (seen.has(p.studentId)) return;
      seen.add(p.studentId);
      rows.push({ id: p.studentId, name: displayName(p.studentId), metric, why });
    };
    for (const p of lowAttendance) {
      // The reason is interpolated, not written out. It read "Below 75%
      // attendance" while `lowAttendance` was filtering on ATTENDANCE_LOW — a
      // teacher was told a student had failed a bar the app was not using.
      push(p, `${Math.round(p.attendancePct)}% att`, `Below ${ATTENDANCE_LOW}% attendance`);
    }
    for (const p of pendingHwStudents) {
      const missing = Math.max(0, p.homeworkAssigned - p.homeworkSubmitted);
      push(
        p,
        `${Math.round(p.homeworkCompletionPct)}% HW`,
        missing > 0
          ? `${missing} homework missing/pending`
          : "Low homework completion",
      );
    }
    for (const p of lowAverages) {
      const parts: string[] = [];
      if (p.testsAvgPct > 0 && p.testsAvgPct < SUBJECT_AVERAGE_LOW)
        parts.push(`tests ${Math.round(p.testsAvgPct)}%`);
      if (p.examsAvgPct > 0 && p.examsAvgPct < SUBJECT_AVERAGE_LOW)
        parts.push(`exams ${Math.round(p.examsAvgPct)}%`);
      push(p, parts.join(" · ") || "Low avg", `Average under ${SUBJECT_AVERAGE_LOW}%`);
    }
    return rows.slice(0, 10);
  }, [lowAttendance, pendingHwStudents, lowAverages, nameById]);

  const workProblemRows = useMemo((): DecisionRow[] => {
    const rows: DecisionRow[] = [];
    for (const h of lowCompletionHw) {
      rows.push({
        id: `hw-low-${h.id}`,
        name: h.title || "Homework",
        metric: `${Math.round(h.completionPct)}%`,
        why: `${h.pending} pending · ${h.submitted}/${h.totalStudents} submitted`,
      });
    }
    for (const h of lateHomework) {
      if (rows.some((r) => r.id === `hw-low-${h.id}`)) continue;
      rows.push({
        id: `hw-late-${h.id}`,
        name: h.title || "Homework",
        metric: `${h.late} late`,
        why: "Late submissions need follow-up",
      });
    }
    for (const t of testsNeedingPublish.slice(0, 5)) {
      rows.push({
        id: `test-${t.id}`,
        name: t.title || "Test",
        metric: resolveTestStatus(t),
        why: "Draft/scheduled — needs publish",
      });
    }
    for (const e of examsAwaitingMarks.slice(0, 5)) {
      rows.push({
        id: `exam-${e.id}`,
        name: e.name || "Exam",
        metric: e.subject || "marks",
        why: "Awaiting marks entry (not locked)",
      });
    }
    return rows.slice(0, 12);
  }, [lowCompletionHw, lateHomework, testsNeedingPublish, examsAwaitingMarks]);

  // doingWellRows removed (§10.8). It ranked the class by exam+test average and
  // took the top five — a peer-model list, which is a strength ranking of named
  // children. The section that rendered it is gone; the computation goes with it.

  const interventionRows = useMemo((): DecisionRow[] => {
    const scored = profiles.map((p) => {
      const flags: string[] = [];
      // Same guard, same reason: an unmarked register is not poor attendance,
      // and homework nobody set is not homework nobody did.
      if (p.attendanceTotal > 0 && p.attendancePct < ATTENDANCE_LOW)
        flags.push("low attendance");
      if (
        p.homeworkAssigned > 0 &&
        (p.homeworkCompletionPct < HOMEWORK_LOW || p.homeworkSubmitted < p.homeworkAssigned)
      )
        flags.push("missing homework");
      if (
        (p.testsAvgPct > 0 && p.testsAvgPct < SUBJECT_AVERAGE_LOW) ||
        (p.examsAvgPct > 0 && p.examsAvgPct < SUBJECT_AVERAGE_LOW)
      )
        flags.push("low averages");
      return { p, flags };
    });
    return scored
      .filter((s) => s.flags.length >= 1)
      .sort((a, b) => {
        if (b.flags.length !== a.flags.length) return b.flags.length - a.flags.length;
        return (
          a.p.attendancePct +
          a.p.homeworkCompletionPct -
          (b.p.attendancePct + b.p.homeworkCompletionPct)
        );
      })
      .slice(0, 8)
      .map(({ p, flags }) => ({
        id: p.studentId,
        name: displayName(p.studentId),
        metric:
          flags.length >= 2
            ? `${flags.length} concerns`
            : `${Math.round(p.attendancePct)}% att`,
        why:
          flags.length >= 2
            ? `Consecutive concerns: ${flags.join(", ")}`
            : flags[0] === "low attendance"
              ? `Lowest attendance · ${Math.round(p.attendancePct)}%`
              : flags[0] === "missing homework"
                ? `HW ${Math.round(p.homeworkCompletionPct)}% · missing work`
                : `Low averages · T ${Math.round(p.testsAvgPct)}% · E ${Math.round(p.examsAvgPct)}%`,
      }));
  }, [profiles, nameById]);

  const focusSummary = useMemo(() => {
    const studentAction = new Set([
      ...needsAttentionRows.map((r) => r.id),
      ...interventionRows.filter((r) => r.metric.includes("concerns")).map((r) => r.id),
    ]);
    const itemAction =
      lowCompletionHw.filter((h) => h.completionPct < HOMEWORK_ITEM_NEEDS_ACTION).length +
      lateHomework.length +
      testsNeedingPublish.length +
      examsAwaitingMarks.length;
    return {
      students: studentAction.size,
      items: itemAction,
    };
  }, [
    needsAttentionRows,
    interventionRows,
    lowCompletionHw,
    lateHomework,
    testsNeedingPublish,
    examsAwaitingMarks,
  ]);

  if (loading) return <Loading label="Loading decision dashboard…" />;
  if (!analytics && profiles.length === 0) {
    return (
      <div className="text-xs text-destructive py-8 text-center">
        {error ?? "No insights available"}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-[2px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div>
        <div className="text-sm font-bold text-foreground">Teacher decision dashboard</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          {focusSummary.students === 0 && focusSummary.items === 0
            ? "Today's focus: none — class looks healthy"
            : `Today's focus: ${focusSummary.students} student${focusSummary.students === 1 ? "" : "s"} and ${focusSummary.items} work item${focusSummary.items === 1 ? "" : "s"} need action`}
        </div>
      </div>

      {analytics && (
        <div className="bg-surface border border-border/70 rounded-[2px] px-3 py-2.5 overflow-x-auto">
          <div className="flex items-center gap-4 sm:gap-5 min-w-max text-[10px]">
            <div>
              <span className="text-muted-foreground">Attendance </span>
              <span className="font-bold text-foreground tabular-nums">
                {toPercentLabel(analytics.avgAttendancePct)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">HW </span>
              <span className="font-bold text-foreground tabular-nums">
                {toPercentLabel(analytics.avgHomeworkCompletionPct)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Test avg </span>
              <span className="font-bold text-foreground tabular-nums">
                {toPercentLabel(analytics.avgTestsPct)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Exam avg </span>
              <span className="font-bold text-foreground tabular-nums">
                {toPercentLabel(analytics.avgExamsPct)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Active HW </span>
              <span className="font-bold text-foreground tabular-nums">{activeHomework.length}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Active tests </span>
              <span className="font-bold text-foreground tabular-nums">{activeTests.length}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Upcoming exams </span>
              <span className="font-bold text-foreground tabular-nums">{upcomingExams.length}</span>
            </div>
            {/* Practice rate removed: locked decision 10.8 makes practice private
                to the student, so no class-level practice aggregate exists. */}
            {progression?.class_engagement && (
              <div>
                <span className="text-muted-foreground">Avg XP </span>
                <span className="font-bold text-foreground tabular-nums">
                  {progression.class_engagement.avg_xp}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {progression && (
        <>
          <DecisionSection
            title="Top XP (class)"
            question="Who is most engaged this term?"
            rows={(progression.top_xp ?? []).slice(0, 8).map((r) => ({
              id: r.student_id,
              name: r.full_name,
              metric: `${r.xp} XP · L${r.level}`,
              why: `${r.league} league`,
            }))}
            empty="No XP data yet"
          />
          <DecisionSection
            title="Improvers (7 days)"
            question="Who gained the most XP this week?"
            rows={(progression.improvers ?? []).slice(0, 8).map((r) => ({
              id: r.student_id,
              name: r.full_name,
              metric: `+${r.xp_gained_7d} XP`,
              why: "Weekly improvement",
            }))}
            empty="No improvers this week"
          />
          <DecisionSection
            title="Inactive (7+ days)"
            question="Who needs a gentle nudge?"
            rows={(progression.inactive ?? []).slice(0, 8).map((r) => ({
              id: r.student_id,
              name: r.full_name,
              metric: r.last_activity_at
                ? new Date(r.last_activity_at).toLocaleDateString()
                : "Never",
              why: "No recent academic activity",
            }))}
            empty="No inactive students"
          />
          {/* "Consistent practicers" removed: it read practice session counts,
              which locked decision 10.16 lists as private to the student. It is
              deleted rather than left rendering an empty list, because "No
              consistent practicers yet" told the teacher the class had done no
              practice, when the data is simply not theirs to see. */}
        </>
      )}

      <DecisionSection
        title="Needs attention today"
        question="Who should I check on before the day ends?"
        rows={needsAttentionRows}
        empty="None — class looks healthy"
      />

      <DecisionSection
        title="Academic work creating problems"
        question="Which homework, tests, or exams need my action?"
        rows={workProblemRows}
        empty="None — work pipeline looks clear"
        metricClass="text-warning"
      />

      {/*
        §10.8 — "Strong areas are never shown anywhere in the app. The product
        surfaces weaknesses only."

        A DecisionSection headed "Doing well", asking "Who can I reinforce or use
        as peer models?", listing named students. The rule says anywhere, and a
        teacher screen naming the strongest children is the case it most plainly
        covers — a peer-model list is a ranking of pupils by strength.

        Removed with its row builder; a value computed and discarded is one
        refactor from being live.
      */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DecisionSection
          title="Require intervention"
          question="Who has stacked risks that need a conversation?"
          rows={interventionRows}
          empty="None — no stacked concerns"
        />
      </div>
    </div>
  );
}
