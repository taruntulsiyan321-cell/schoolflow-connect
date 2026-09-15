import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import {
  AttendanceService,
  HOMEWORK_STANDING_LABELS,
  HomeworkService,
  homeworkHasClosed,
  homeworkStanding,
  useAcademicLive,
  type ClassStudentRow,
  type HomeworkStanding,
  type ReviewRow,
} from "@/academic";
import type { HomeworkStandingRow } from "@/academic/repository/homeworkRepository";
import type { ClassHomeworkCompletion, ClassHomeworkRow } from "@/academic/services/homeworkService";
import {
  classHomeworkReportFilename,
  classHomeworkReportRows,
  classHomeworkTally,
  homeworkReportFilename,
  homeworkReportRows,
  inRegisterOrder,
} from "@/academic/services/homeworkReport";
import { attachmentOfFile } from "@/academic/storage/academicFileUpload";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { AttachmentList } from "@/gurukul-teacher/AttachmentUI";
import { exportCSV } from "@/lib/exportCsv";
import { displaySubject, toErrorMessage } from "@/lib/presentation";
import { ClassTestsTable, TestMarks } from "./PrincipalTests";
import { BackButton, EmptyState, Label, LoadingRow, Pill, SectionHeading } from "./primitives";
import { classLabel, useSchoolClasses, type ClassRow } from "./useSchoolClasses";

/**
 * THE PRINCIPAL'S CLASSES TAB, ON REAL DATA.
 *
 * Asked 2026-09-15: does the principal see homework "from their panel while
 * going on the class tab", and does it update there. It did not. The Classes
 * tab was the fixture design (`autonomous-design/data.ts`): eight invented
 * classes, each carrying the same five invented homework and a hard-coded
 * completion rate, under ids that exist in no database — no homework a teacher
 * set could ever appear there, and nothing a student handed in could move it.
 *
 * So the tab is rebuilt live, in the portal's own primitives:
 *
 *   classes  — every active class: its roll, the homework released to it, how
 *              much of the homework that has closed was handed in, and the
 *              hand-ins waiting on a teacher.
 *   class    — Homework: each released homework and its hand-ins so far.
 *              Students: each student's homework record — done, missed at the
 *              deadline, still open — and the class report as a download.
 *              Tests: the Tests tab's own table (one component, two tabs).
 *   homework — the question, every student's standing and file, and the
 *              homework's report as a download, built by the same function as
 *              the teacher's.
 *
 * Every read re-runs when `homework` or `homework_submissions` changes anywhere
 * in the school (AcademicLiveProvider's realtime subscription), so a hand-in or
 * a decision moves these screens while the principal is looking at them.
 *
 * The principal reads. Accepting and rejecting stay with the subject's teachers.
 */

type ClassTab = "homework" | "students" | "tests";

type Screen =
  | { id: "classes" }
  | { id: "class"; cls: ClassRow; tab: ClassTab }
  | { id: "homework"; cls: ClassRow; homework: ClassHomeworkRow }
  | { id: "test"; cls: ClassRow; testId: string };

const TABS: { id: ClassTab; label: string }[] = [
  { id: "homework", label: "Homework" },
  { id: "students", label: "Students" },
  { id: "tests", label: "Tests" },
];

/** Work waiting on a teacher first, then what can still change, then what is settled. */
const STANDING_ORDER: HomeworkStanding[] = ["handed_in", "rejected", "to_do", "not_handed_in", "accepted"];

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export default function PrincipalClasses() {
  const [screen, setScreen] = useState<Screen>({ id: "classes" });

  if (screen.id === "classes") {
    return <ClassList onOpen={(cls) => setScreen({ id: "class", cls, tab: "homework" })} />;
  }
  if (screen.id === "class") {
    return (
      <ClassScreen
        cls={screen.cls}
        tab={screen.tab}
        onTab={(tab) => setScreen({ id: "class", cls: screen.cls, tab })}
        onBack={() => setScreen({ id: "classes" })}
        onOpenHomework={(homework) => setScreen({ id: "homework", cls: screen.cls, homework })}
        onOpenTest={(testId) => setScreen({ id: "test", cls: screen.cls, testId })}
      />
    );
  }
  if (screen.id === "homework") {
    return (
      <HomeworkDetail
        cls={screen.cls}
        homework={screen.homework}
        onBack={() => setScreen({ id: "class", cls: screen.cls, tab: "homework" })}
      />
    );
  }
  return (
    <TestMarks
      classId={screen.cls.id}
      className={classLabel(screen.cls)}
      testId={screen.testId}
      onBack={() => setScreen({ id: "class", cls: screen.cls, tab: "tests" })}
    />
  );
}

function ReportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border bg-card hover:bg-secondary transition-colors"
    >
      <Download className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

/** Every active class, with its roll and its homework. */
function ClassList({ onOpen }: { onOpen: (cls: ClassRow) => void }) {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["homework", "profile"]);
  const { rows, error } = useSchoolClasses();
  const [completion, setCompletion] = useState<Map<string, ClassHomeworkCompletion> | null>(null);
  const [homeworkError, setHomeworkError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await HomeworkService.completionByClass(ctx);
        if (!cancelled) {
          setCompletion(next);
          setHomeworkError(null);
        }
      } catch (e) {
        if (!cancelled) setHomeworkError(toErrorMessage(e, "Could not load the classes' homework"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, liveVersion]);

  const pending = completion === null && !homeworkError;

  return (
    <div className="p-8 scroll-y h-full">
      <Label>School</Label>
      <SectionHeading>Classes</SectionHeading>
      <div className="text-sm text-muted-foreground mb-6">
        Each class&apos;s homework: what was released, how much of it was handed in by its deadline, and what is
        waiting on a teacher.
      </div>

      {(error || homeworkError) && <div className="text-sm text-destructive mb-4">{error ?? homeworkError}</div>}

      <div className="border border-border bg-card max-w-3xl">
        <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
          <div className="flex-1">
            <Label>Class</Label>
          </div>
          <div className="w-20 text-right">
            <Label>Students</Label>
          </div>
          <div className="w-24 text-right">
            <Label>Homework</Label>
          </div>
          <div className="w-40 text-right">
            <Label>Handed in by deadline</Label>
          </div>
          <div className="w-32 text-right">
            <Label>Awaiting review</Label>
          </div>
        </div>
        {rows === null ? (
          <>
            <LoadingRow />
            <LoadingRow />
            <LoadingRow />
          </>
        ) : rows.length === 0 ? (
          <EmptyState title="No classes on roll." detail="Classes appear here once the office creates them." />
        ) : (
          rows.map((c) => {
            const hw = completion?.get(c.id);
            const pct = hw?.completionPct ?? null;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpen(c)}
                className="w-full flex items-center px-4 py-3 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors text-left"
              >
                <div className="flex-1 text-sm font-medium">{classLabel(c)}</div>
                <div className="w-20 text-right font-mono text-sm">{c.students}</div>
                <div className="w-24 text-right font-mono text-sm">
                  {pending ? "…" : hw ? hw.closedHomework + hw.openHomework : 0}
                </div>
                {/* "—" until something has closed: a class is not at 0% on work
                    its students still have time to hand in. */}
                <div className="w-40 text-right font-mono text-sm text-muted-foreground">
                  {pending ? "…" : pct === null ? "—" : `${pct}%`}
                </div>
                <div className="w-32 text-right font-mono text-sm text-muted-foreground">
                  {pending ? "…" : hw?.awaitingReview ?? 0}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function ClassScreen({
  cls,
  tab,
  onTab,
  onBack,
  onOpenHomework,
  onOpenTest,
}: {
  cls: ClassRow;
  tab: ClassTab;
  onTab: (tab: ClassTab) => void;
  onBack: () => void;
  onOpenHomework: (homework: ClassHomeworkRow) => void;
  onOpenTest: (testId: string) => void;
}) {
  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={onBack} />
      <Label>Classes</Label>
      <SectionHeading>{classLabel(cls)}</SectionHeading>
      <div className="text-sm text-muted-foreground mb-5">
        {cls.students} {cls.students === 1 ? "student" : "students"} on the roll
      </div>

      <div className="flex gap-0 border border-border w-fit mb-6" role="tablist">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onTab(t.id)}
            className={`px-5 py-2 text-xs ${i > 0 ? "border-l border-border" : ""} ${
              tab === t.id ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
            } transition-colors`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "homework" && <ClassHomework classId={cls.id} onOpen={onOpenHomework} />}
      {tab === "students" && <ClassStudents cls={cls} />}
      {tab === "tests" && <ClassTestsTable classId={cls.id} onOpenTest={onOpenTest} />}
    </div>
  );
}

/** Every homework released to the class, the latest deadline first. */
function ClassHomework({ classId, onOpen }: { classId: string; onOpen: (homework: ClassHomeworkRow) => void }) {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["homework", "profile"]);
  const [items, setItems] = useState<ClassHomeworkRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await HomeworkService.listPublishedForClass(ctx, classId);
        if (!cancelled) {
          setItems([...rows].sort((a, b) => Date.parse(b.closesAt) - Date.parse(a.closesAt)));
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, "Could not load this class's homework"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, classId, liveVersion]);

  return (
    <>
      {error && <div className="text-sm text-destructive mb-4">{error}</div>}
      <div className="border border-border bg-card max-w-3xl">
        <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
          <div className="flex-1">
            <Label>Homework</Label>
          </div>
          <div className="w-44">
            <Label>Deadline</Label>
          </div>
          <div className="w-24 text-right">
            <Label>Handed in</Label>
          </div>
          <div className="w-32 text-right">
            <Label>Awaiting review</Label>
          </div>
          <div className="w-20 text-right">
            <Label>State</Label>
          </div>
        </div>
        {items === null ? (
          <>
            <LoadingRow />
            <LoadingRow />
          </>
        ) : items.length === 0 ? (
          <EmptyState
            title="No homework released to this class yet."
            detail="Homework appears here the moment a teacher releases it."
          />
        ) : (
          items.map((hw) => {
            const closed = homeworkHasClosed(hw);
            return (
              <button
                key={hw.id}
                type="button"
                onClick={() => onOpen(hw)}
                className="w-full flex items-center px-4 py-3 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{hw.title}</div>
                  <div className="text-xs text-muted-foreground">{displaySubject(hw.subject)}</div>
                </div>
                <div className="w-44 font-mono text-xs text-muted-foreground">{when(hw.closesAt)}</div>
                <div className="w-24 text-right font-mono text-sm">
                  {hw.completion ? `${hw.completion.given} / ${hw.completion.students}` : "—"}
                </div>
                <div className="w-32 text-right font-mono text-sm text-muted-foreground">
                  {hw.completion?.awaitingReview ?? 0}
                </div>
                <div className="w-20 text-right">
                  <Pill variant={closed ? "muted" : "default"}>{closed ? "Closed" : "Open"}</Pill>
                </div>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

/** Each student's homework record in the class, and the class report. */
function ClassStudents({ cls }: { cls: ClassRow }) {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["homework", "profile"]);
  const [data, setData] = useState<{ standings: HomeworkStandingRow[]; roster: ClassStudentRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      try {
        const [standings, roster] = await Promise.all([
          HomeworkService.standingsForClass(ctx, cls.id),
          AttendanceService.listClassStudents(ctx, cls.id),
        ]);
        if (!cancelled) {
          setData({ standings, roster });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, "Could not load this class's homework record"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, cls.id, liveVersion]);

  const tally = data ? classHomeworkTally(data.standings, data.roster) : null;

  return (
    <>
      <div className="flex items-center gap-3 mb-3 max-w-3xl">
        <div className="flex-1 text-sm text-muted-foreground">
          Every student&apos;s released homework, counted at each deadline: done, missed, or still open.
        </div>
        {tally && tally.length > 0 && (
          <ReportButton
            label="Download class report"
            onClick={() => exportCSV(classHomeworkReportFilename(classLabel(cls)), classHomeworkReportRows(tally))}
          />
        )}
      </div>
      {error && <div className="text-sm text-destructive mb-4">{error}</div>}
      <div className="border border-border bg-card max-w-3xl">
        <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
          <div className="w-12">
            <Label>Roll</Label>
          </div>
          <div className="flex-1">
            <Label>Student</Label>
          </div>
          <div className="w-16 text-right">
            <Label>Set</Label>
          </div>
          <div className="w-16 text-right">
            <Label>Done</Label>
          </div>
          <div className="w-20 text-right">
            <Label>Missed</Label>
          </div>
          <div className="w-20 text-right">
            <Label>Still open</Label>
          </div>
        </div>
        {tally === null ? (
          <>
            <LoadingRow />
            <LoadingRow />
            <LoadingRow />
          </>
        ) : tally.length === 0 ? (
          <EmptyState title="No students on this class's roll." />
        ) : (
          tally.map(({ roll, name, row }) => (
            <div key={row.studentId} className="flex items-center px-4 py-2.5 border-b border-border last:border-b-0">
              <div className="w-12 font-mono text-xs text-muted-foreground">{roll || "—"}</div>
              <div className="flex-1 text-sm truncate">{name}</div>
              <div className="w-16 text-right font-mono text-sm">{row.set}</div>
              <div className="w-16 text-right font-mono text-sm">{row.done}</div>
              <div className={`w-20 text-right font-mono text-sm ${row.missed > 0 ? "font-medium" : "text-muted-foreground"}`}>
                {row.missed}
              </div>
              <div className="w-20 text-right font-mono text-sm text-muted-foreground">{row.toDo}</div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

/** One homework: the question, and where every student it was set to stands. */
function HomeworkDetail({
  cls,
  homework,
  onBack,
}: {
  cls: ClassRow;
  homework: ClassHomeworkRow;
  onBack: () => void;
}) {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["homework", "profile"]);
  const [data, setData] = useState<{ rows: ReviewRow[]; roster: ClassStudentRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      try {
        const [rows, roster] = await Promise.all([
          HomeworkService.listForReview(ctx, homework.id),
          AttendanceService.listClassStudents(ctx, cls.id),
        ]);
        if (!cancelled) {
          setData({ rows, roster });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, "Could not load who handed this homework in"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, homework.id, cls.id, liveVersion]);

  const ordered = data ? inRegisterOrder(data.rows, data.roster) : null;
  const closed = homeworkHasClosed(homework);

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={onBack} />
      <Label>{classLabel(cls)} · Homework</Label>
      <SectionHeading>{homework.title}</SectionHeading>
      <div className="text-sm text-muted-foreground mb-4">
        {displaySubject(homework.subject)} · Deadline {when(homework.closesAt)} · {closed ? "Closed" : "Open"}
      </div>

      <div className="max-w-3xl mb-6">
        {homework.questionFile ? (
          <AttachmentList items={[attachmentOfFile(homework.questionFile)]} dense />
        ) : homework.questionText ? (
          <div className="text-sm whitespace-pre-wrap">{homework.questionText}</div>
        ) : null}
      </div>

      {error && <div className="text-sm text-destructive mb-4">{error}</div>}

      <div className="flex flex-wrap items-end gap-3 mb-6 max-w-3xl">
        {STANDING_ORDER.map((s) => (
          <div key={s} className="bg-card border border-border px-3 py-2.5">
            <Label className="block mb-1">{HOMEWORK_STANDING_LABELS[s]}</Label>
            <div className="font-mono text-xl">
              {data ? data.rows.filter((r) => homeworkStanding(r.standing) === s).length : "…"}
            </div>
          </div>
        ))}
        {data && data.rows.length > 0 && (
          <ReportButton
            label="Download report"
            onClick={() => exportCSV(homeworkReportFilename(homework), homeworkReportRows(data.rows, data.roster))}
          />
        )}
      </div>

      <div className="border border-border bg-card max-w-3xl">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-secondary/40">
          <div className="w-12">
            <Label>Roll</Label>
          </div>
          <div className="flex-1">
            <Label>Student</Label>
          </div>
          <div className="w-48">
            <Label>Standing</Label>
          </div>
          <div className="w-40">
            <Label>Handed in</Label>
          </div>
          <div className="w-56">
            <Label>File</Label>
          </div>
        </div>
        {ordered === null ? (
          <>
            <LoadingRow />
            <LoadingRow />
            <LoadingRow />
          </>
        ) : ordered.length === 0 ? (
          <EmptyState
            title="No student is counted on this homework."
            detail="The class had no students when it was released."
          />
        ) : (
          ordered.map(({ roll, name, row }) => (
            <div key={row.studentId} className="flex items-center gap-2 px-4 py-2.5 border-b border-border last:border-b-0">
              <div className="w-12 font-mono text-xs text-muted-foreground">{roll || "—"}</div>
              <div className="flex-1 text-sm truncate">{name}</div>
              <div className="w-48 text-xs">{HOMEWORK_STANDING_LABELS[homeworkStanding(row.standing)]}</div>
              <div className="w-40 font-mono text-xs text-muted-foreground">
                {row.submission?.submittedAt ? when(row.submission.submittedAt) : "—"}
              </div>
              <div className="w-56">
                {row.submission?.file ? (
                  <AttachmentList items={[attachmentOfFile(row.submission.file)]} dense />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="text-xs text-muted-foreground mt-4 max-w-3xl">
        Accepting or rejecting a hand-in is for the teachers of {displaySubject(homework.subject)} in this class.
      </div>
    </div>
  );
}
