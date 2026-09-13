/**
 * THE TEACHER'S TEST REPORT (§10.25) — what one class did with one paper.
 *
 * Its own file because it is its own screen. It lived inside `LiveTestsTab`,
 * which is the test LIST and its builder; a report that answers four different
 * questions does not belong inside the thing that lists the papers.
 *
 * FOUR READS, FOUR QUESTIONS, and each of them is a separate RPC because each
 * is a separate fact the others cannot express:
 *
 *   rpc_test_class_report        the aggregate + the weakest topics
 *   rpc_test_leaderboard         the class BY MARK, ranked, ties shared — the
 *                                same order and rank the students see, so the
 *                                board a teacher reads and the board a student
 *                                reads can never disagree
 *   rpc_test_question_breakdown  every question with what it COST: the four
 *                                outcome states apart, the average and longest
 *                                time on THAT question, and who it cost most
 *   rpc_test_answer_sheet        one student's whole paper, per question, with
 *                                their own time on each
 *
 * The report this replaces had a single `average_seconds_per_question` for the
 * whole paper and a drill-down that showed a student's WRONG answers only.
 * Neither can answer what a teacher actually asks: which question do I re-teach,
 * and how did this child do. A paper mean cannot name a question, and a list of
 * wrong answers is empty for the student who scored full marks.
 *
 * EVERY FENCE IS THE DATABASE'S. There is no role check in this file and none
 * in the service: `can_read_test_report` and `can_read_test_leaderboard` are the
 * only homes for those rules, and a caller who may not read gets 42501 back,
 * screened into a sentence.
 */
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { cn } from "./shared";
import { TestService } from "@/academic";
import type {
  TestAnswerSheet,
  TestClassReport,
  TestLeaderboard,
  TestQuestionBreakdown,
} from "@/academic/services/testService";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { answerToText } from "@/academic/services/answerText";
import {
  answerSheetCsvRows,
  classReportCsvRows,
  questionBreakdownCsvRows,
} from "@/academic/services/testReportSheets";
import {
  displayTopic,
  toCountLabel,
  toDisplayText,
  toErrorMessage,
  toPercentLabel,
  toPersonName,
} from "@/lib/presentation";
import { exportCSV } from "@/lib/exportCsv";

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-8 text-muted-foreground text-xs gap-2">
      {label}…
    </div>
  );
}

/**
 * The four things a teacher opens a test report to find out, as four tabs
 * rather than one scroll: where the class stands, which question cost them,
 * what they got wrong, and who is missing.
 */
type ReportTab = "leaderboard" | "questions" | "topics" | "class";

const REPORT_TABS: { key: ReportTab; label: string }[] = [
  { key: "leaderboard", label: "Leaderboard" },
  { key: "questions", label: "Questions" },
  { key: "topics", label: "Topics" },
  { key: "class", label: "Class list" },
];

/**
 * Milliseconds as a duration a person reads — or the missing-data label when
 * there is no clock at all.
 *
 * `0s` for an untimed answer is the exact defect §7 names: it states that the
 * student answered instantly, which is a fact nobody measured. Every timing on
 * this screen goes through here.
 */
function msLabel(ms: number | null | undefined): string {
  if (ms == null) return toCountLabel(null);
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}

/**
 * The one question that cost the class the most time, by average — or null when
 * nothing on the paper carries a clock, so nothing is marked rather than the
 * first question being marked by default.
 */
function slowestQuestionId(b: TestQuestionBreakdown | null): string | null {
  if (!b) return null;
  let best: { id: string; ms: number } | null = null;
  for (const q of b.questions) {
    if (q.avg_time_ms == null) continue;
    if (!best || q.avg_time_ms > best.ms) best = { id: q.question_id, ms: q.avg_time_ms };
  }
  return best?.id ?? null;
}

/**
 * ONE STUDENT'S PERFORMANCE ON ONE PAPER — what opens when a teacher clicks a
 * name, on either list.
 *
 * This used to be the wrong answers and nothing else, which cannot show a
 * performance: a student who scored full marks opened to an empty panel, and
 * nothing said how long anything took them. It is now the whole paper —
 * every question, their answer against the key, and THEIR time on each, with
 * their own slowest marked.
 *
 * Three empty states, kept apart, because they are three different facts: they
 * did not sit it, they sat it and the sheet is still loading, and they sat it
 * and answered nothing.
 */
function StudentPerformance({
  drill,
  loading,
  error,
  rank,
  outOf,
}: {
  drill: TestAnswerSheet | null;
  loading: boolean;
  error: string | null;
  rank: number | null;
  outOf: number | null;
}) {
  const slowest = (() => {
    if (!drill) return null;
    let best: { id: string; ms: number } | null = null;
    for (const q of drill.questions) {
      if (q.time_ms == null) continue;
      if (!best || q.time_ms > best.ms) best = { id: q.question_id, ms: q.time_ms };
    }
    return best?.id ?? null;
  })();

  const blanks = drill ? drill.questions.filter((q) => !q.answered).length : 0;
  const wrong = drill ? drill.questions.filter((q) => q.answered && !q.is_correct).length : 0;

  return (
    <div className="mt-1 ml-2 rounded-[2px] border border-border/60 bg-muted/20 px-2 py-2 space-y-2">
      {loading && <Loading label="Loading" />}
      {error && <div className="text-[10px] text-destructive">{error}</div>}
      {drill && !drill.submitted && (
        <div className="text-[10px] text-muted-foreground">
          This student did not sit the test, so there is nothing to review.
        </div>
      )}
      {drill && drill.submitted && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[10px] font-bold text-foreground">
              {toCountLabel(drill.mark)}
              {drill.max_mark != null ? ` / ${drill.max_mark}` : ""}
            </span>
            {/* A rank without the field it is out of is half a fact. */}
            <span className="text-[9px] text-muted-foreground">
              {rank != null ? `Rank ${rank}${outOf != null ? ` of ${outOf}` : ""}` : "Rank —"}
            </span>
            <span className="text-[9px] text-success">
              {toCountLabel(drill.correct_count)} right
            </span>
            <span className="text-[9px] text-destructive">{wrong} wrong</span>
            <span className="text-[9px] text-muted-foreground">{blanks} left blank</span>
            <span className="text-[9px] text-muted-foreground">
              {drill.time_spent_sec == null
                ? toCountLabel(null)
                : msLabel(drill.time_spent_sec * 1000)}{" "}
              on the paper
            </span>
            <button
              type="button"
              onClick={() =>
                exportCSV(
                  `test-paper-${drill.test_id}-${drill.student_id}`,
                  answerSheetCsvRows(drill),
                )
              }
              className="ml-auto px-2 py-1 rounded-lg text-[10px] font-bold bg-muted text-muted-foreground flex items-center gap-1"
            >
              <Download className="w-3 h-3" /> CSV
            </button>
          </div>

          {drill.questions.length === 0 ? (
            <div className="text-[10px] text-muted-foreground">
              This paper has no questions on it.
            </div>
          ) : (
            drill.questions.map((q, i) => {
              const theirs = answerToText(q.their_answer, q.options);
              const right = answerToText(q.correct_answer, q.options);
              return (
                <div
                  key={q.question_id}
                  className={cn(
                    "rounded-lg border px-2 py-1.5 space-y-0.5",
                    q.question_id === slowest
                      ? "border-warning/50 bg-warning/10"
                      : "border-border/60 bg-surface",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-[9px] font-mono text-muted-foreground shrink-0 pt-0.5">
                      {(q.order_index ?? i) + 1}
                    </span>
                    <span className="text-[10px] text-foreground flex-1">
                      {toDisplayText(q.question, { fallback: "Question" })}
                    </span>
                    <span
                      className={cn(
                        "text-[8px] font-bold shrink-0 uppercase tracking-wider",
                        !q.answered
                          ? "text-muted-foreground"
                          : q.is_correct
                            ? "text-success"
                            : "text-destructive",
                      )}
                    >
                      {!q.answered ? "Blank" : q.is_correct ? "Right" : "Wrong"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 pl-5">
                    <span className="text-[9px] text-muted-foreground">
                      {displayTopic(q.topic) || q.topic}
                    </span>
                    <span className="text-[9px] text-foreground">
                      {msLabel(q.time_ms)}
                      {q.question_id === slowest ? " · their longest" : ""}
                    </span>
                    {q.marks != null && (
                      <span className="text-[9px] text-muted-foreground">
                        {toCountLabel(q.marks_awarded)} of {q.marks}
                      </span>
                    )}
                  </div>
                  <div className="text-[9px] pl-5">
                    <span className={q.is_correct ? "text-success" : "text-destructive"}>
                      {!q.answered
                        ? "Left blank"
                        : theirs != null
                          ? `Answered: ${theirs}`
                          : "Their answer was recorded in a form this screen cannot read"}
                    </span>
                    {right != null && !q.is_correct && (
                      <span className="text-success"> · Correct: {right}</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}

export function TestReportPanel({ testId }: { testId: string }) {
  const { ctx, ready } = useAcademicContext();
  const [report, setReport] = useState<TestClassReport | null>(null);
  const [board, setBoard] = useState<TestLeaderboard | null>(null);
  const [breakdown, setBreakdown] = useState<TestQuestionBreakdown | null>(null);
  const [reportTab, setReportTab] = useState<ReportTab>("leaderboard");
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const [drillStudentId, setDrillStudentId] = useState<string | null>(null);
  const [drill, setDrill] = useState<TestAnswerSheet | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    setReportLoading(true);
    setReportError(null);
    // One await, not three in a row: the three reads are independent and a
    // teacher should not watch them arrive one at a time.
    void Promise.all([
      TestService.classReport(ctx, testId),
      TestService.leaderboard(ctx, testId),
      TestService.questionBreakdown(ctx, testId),
    ])
      .then(([aggregate, ranked, perQuestion]) => {
        if (cancelled) return;
        setReport(aggregate);
        setBoard(ranked);
        setBreakdown(perQuestion);
      })
      .catch((e) => {
        if (!cancelled) setReportError(toErrorMessage(e, "Could not load the report for this test"));
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, testId]);

  const openDrill = async (studentId: string) => {
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
      // The whole paper as that student answered it — every question, their
      // answer, the key, and the time each one cost them. `studentReport`
      // returns only the questions they got wrong, which cannot show a
      // performance: a student who scored full marks came back empty.
      setDrill(await TestService.answerSheet(ctx, testId, studentId));
    } catch (e) {
      setDrillError(toErrorMessage(e, "Could not load this student's paper"));
    } finally {
      setDrillLoading(false);
    }
  };

  return (
      <div className="pt-2 mt-1 border-t border-border/60 space-y-3">
        {reportLoading && <Loading label="Loading report" />}
        {reportError && (
          <div className="rounded-[2px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            {reportError}
          </div>
        )}
        {report && (
          <>
            {/* Two numbers, not three. The third used to be
                "Avg per question" — the paper's mean divided by its
                length, which cannot tell nineteen quick questions
                and one twelve-minute one from twenty even ones. It
                is deleted, and the Questions tab below is what
                replaces it. */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[2px] bg-muted/60 px-2 py-1.5">
                <div className="text-[9px] text-muted-foreground">Submitted</div>
                <div className="text-xs font-bold text-foreground">
                  {toCountLabel(report.submitted_count)} of {report.students.length}
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
            </div>

            {report.submitted_count === 0 && (
              <div className="text-[10px] text-muted-foreground">
                Nobody has submitted this test yet, so there is no average, no
                ranking and no timing to show.
              </div>
            )}

            <div className="flex items-center gap-1">
              {REPORT_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setReportTab(tab.key)}
                  aria-pressed={reportTab === tab.key}
                  className={cn(
                    "px-2 py-1 rounded-[2px] text-[10px] font-bold transition-colors",
                    reportTab === tab.key
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── Leaderboard: the class by MARK ─────────────────
                The class list further down is ordered by roll number,
                which is the register, not the result. This is the
                order the teacher asked for and the same order, ranks
                and tie rule the students see on their own result
                (rpc_test_leaderboard). */}
            {reportTab === "leaderboard" && (
              <div className="space-y-1">
                {board && board.entries.length > 0 ? (
                  board.entries.map((e) => (
                    <button
                      key={e.student_id}
                      type="button"
                      onClick={() => void openDrill(e.student_id)}
                      aria-expanded={drillStudentId === e.student_id}
                      className="w-full flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1 text-left hover:bg-muted/70 transition-colors"
                    >
                      <span
                        className={cn(
                          "w-5 shrink-0 text-[10px] font-bold text-center",
                          e.rank === 1 ? "text-warning" : "text-muted-foreground",
                        )}
                      >
                        {e.rank}
                      </span>
                      <span className="text-[10px] text-foreground truncate flex-1">
                        {e.roll_number != null && e.roll_number !== ""
                          ? `${e.roll_number}. `
                          : ""}
                        {toPersonName(e.full_name, { kind: "student" })}
                      </span>
                      <span className="text-[9px] text-muted-foreground shrink-0">
                        {toCountLabel(e.correct_count)}/{toCountLabel(e.total_count)}{" "}
                        correct
                      </span>
                      <span className="text-[10px] font-bold text-foreground shrink-0">
                        {toCountLabel(e.mark)}
                        {board.max_mark != null ? ` / ${board.max_mark}` : ""}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="text-[10px] text-muted-foreground">
                    Nobody has handed this test in, so there is nothing to rank.
                  </div>
                )}
                {drillStudentId && (
                  <StudentPerformance
                    drill={drill}
                    loading={drillLoading}
                    error={drillError}
                    rank={
                      board?.entries.find((e) => e.student_id === drillStudentId)?.rank ??
                      null
                    }
                    outOf={board?.submitted_count ?? null}
                  />
                )}
              </div>
            )}

            {/* ── Questions: WHERE THE TIME WENT, question by question */}
            {reportTab === "questions" && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] text-muted-foreground">
                    Longest first is not the paper's order — these are in the order
                    the class sat them.
                  </div>
                  {breakdown && breakdown.questions.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        exportCSV(
                          `test-questions-${breakdown.test_id}`,
                          questionBreakdownCsvRows(breakdown),
                        )
                      }
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted text-muted-foreground flex items-center gap-1 shrink-0"
                    >
                      <Download className="w-3 h-3" /> CSV
                    </button>
                  )}
                </div>
                {breakdown && breakdown.questions.length > 0 ? (
                  breakdown.questions.map((q, i) => {
                    // The costliest question on the paper is marked,
                    // and only when a time exists to compare. With no
                    // clock anywhere, nothing is "slowest".
                    const worst = slowestQuestionId(breakdown);
                    return (
                      <div
                        key={q.question_id}
                        className={cn(
                          "rounded-lg border px-2 py-1.5 space-y-1",
                          q.question_id === worst
                            ? "border-warning/50 bg-warning/10"
                            : "border-border/60 bg-muted/30",
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-[9px] font-mono text-muted-foreground shrink-0 pt-0.5">
                            {(q.order_index ?? i) + 1}
                          </span>
                          <span className="text-[10px] text-foreground flex-1">
                            {toDisplayText(q.question, { fallback: "Question" })}
                          </span>
                          {q.question_id === worst && (
                            <span className="text-[8px] font-bold text-warning shrink-0 uppercase tracking-wider">
                              Took longest
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5">
                          <span className="text-[9px] text-muted-foreground">
                            {displayTopic(q.topic) || q.topic}
                          </span>
                          <span className="text-[9px] text-success">
                            {q.correct_count} right
                          </span>
                          <span className="text-[9px] text-destructive">
                            {q.wrong_count} wrong
                          </span>
                          {/* Blank is its own state. Folding it into
                              "wrong" would report a class that never
                              reached a question as one that
                              misunderstood it (G4). */}
                          <span className="text-[9px] text-muted-foreground">
                            {q.blank_count} left blank
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5">
                          <span className="text-[9px] text-foreground font-bold">
                            {msLabel(q.avg_time_ms)} average
                          </span>
                          <span className="text-[9px] text-muted-foreground">
                            longest {msLabel(q.max_time_ms)}
                            {q.slowest_student_name
                              ? ` · ${toPersonName(q.slowest_student_name, { kind: "student" })}`
                              : ""}
                          </span>
                          {/* Say how much of the class the average is
                              actually made of, so "40s" over three
                              timed answers of twenty-eight cannot
                              read as the whole class. */}
                          {q.timed_count < q.answered_count && (
                            <span className="text-[9px] text-muted-foreground">
                              {q.timed_count} of {q.answered_count} answers timed
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-[10px] text-muted-foreground">
                    No question of this test has been answered yet, so there is
                    nothing to time.
                  </div>
                )}
              </div>
            )}

            {/* ── Topics: what the class got wrong, ranked ───────── */}
            {reportTab === "topics" && (
              <div className="space-y-1">
                {report.weakest_topics.length > 0 ? (
                  report.weakest_topics.map((w) => (
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
                  ))
                ) : (
                  <div className="text-[10px] text-muted-foreground">
                    Nothing has gone wrong on this test yet, so no topic ranks above
                    another.
                  </div>
                )}
              </div>
            )}

            {/* ── Class list: the REGISTER, by roll, everyone on it ─
                Including the students who did not sit it, which the
                leaderboard cannot show — it ranks submissions. */}
            {reportTab === "class" && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] text-muted-foreground">
                    Everyone on the roll, in roll order.
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      exportCSV(`test-report-${report.test_id}`, classReportCsvRows(report))
                    }
                    className="px-2 py-1 rounded-lg text-[10px] font-bold bg-muted text-muted-foreground flex items-center gap-1 shrink-0"
                  >
                    <Download className="w-3 h-3" /> CSV
                  </button>
                </div>
                {report.students.map((s) => (
                  <div key={s.student_id}>
                    <button
                      type="button"
                      onClick={() => void openDrill(s.student_id)}
                      aria-expanded={drillStudentId === s.student_id}
                      className="w-full flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1 text-left hover:bg-muted/70 transition-colors"
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
                      <StudentPerformance
                        drill={drill}
                        loading={drillLoading}
                        error={drillError}
                        rank={
                          board?.entries.find((e) => e.student_id === s.student_id)
                            ?.rank ?? null
                        }
                        outOf={board?.submitted_count ?? null}
                      />
                    )}
                  </div>
                ))}
                {report.students.length === 0 && (
                  <div className="text-[10px] text-muted-foreground">
                    This class has no students on roll.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
  );
}
