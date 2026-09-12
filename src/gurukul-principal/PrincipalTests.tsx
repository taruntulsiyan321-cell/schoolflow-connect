import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TestService, TEST_KIND_LABELS, useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import type { TestClassMarks, TestListRow } from "@/academic/services/testService";
import { displaySubject, toCountLabel, toErrorMessage, toPersonName } from "@/lib/presentation";
import { BackButton, EmptyState, Label, LoadingRow, Pill, SectionHeading } from "./primitives";

/**
 * THE PRINCIPAL'S TEST SCREENS, ON REAL DATA.
 *
 * ── WHAT THIS IS AND IS NOT ─────────────────────────────────────────────────
 *
 * Ruled 2026-09-12: "For the principal, we have to build something like this:
 * on the class tab, the principal shall be able to see the test and the marks
 * each student has got."
 *
 * The principal portal (`autonomous-design/PrincipalPortalDesign.tsx`) has a
 * class → tests → marks flow already and its own header says what it is:
 * "Design-only: screens use fixture data from autonomous-design/data.ts. Not
 * wired to Academic Engine / Supabase." Its class ids are fixture strings that
 * exist in no database, so the marks behind that flow are invented and no
 * amount of wiring at the leaf could fix it.
 *
 * So this is the same three screens, live: the school's real classes, each
 * class's real tests, and each student's real mark — using the portal's own
 * primitives so it reads as one product rather than a bolted-on panel. The
 * fixture screens are left exactly as they are; they are a design, and replacing
 * the whole portal is not this change.
 *
 * ── WHAT THE PRINCIPAL IS NOT SHOWN, AND WHY ────────────────────────────────
 *
 * Marks, and nothing per-question. `rpc_test_class_marks` is fenced by
 * `can_read_test_marks`, which admits them; `rpc_test_class_report` (weakest
 * topics, timing) and `rpc_test_student_report` (which questions a named child
 * got wrong) are fenced by `can_read_test_report` and refuse them — rule 13:
 * "marks and rank are shared within the class; per-question detail is private
 * to each student." Asking anyway would put a 42501 on screen, so this screen
 * does not ask.
 */

type PrincipalTestScreen =
  | { id: "classes" }
  | { id: "class"; classId: string; className: string }
  | { id: "test"; classId: string; className: string; testId: string };

type ClassRow = { id: string; name: string; section: string | null; students: number };

export default function PrincipalTests() {
  const [screen, setScreen] = useState<PrincipalTestScreen>({ id: "classes" });

  if (screen.id === "classes") {
    return <ClassesList onOpen={(c) => setScreen({ id: "class", classId: c.id, className: classLabel(c) })} />;
  }
  if (screen.id === "class") {
    return (
      <ClassTests
        classId={screen.classId}
        className={screen.className}
        onBack={() => setScreen({ id: "classes" })}
        onOpenTest={(testId) =>
          setScreen({ id: "test", classId: screen.classId, className: screen.className, testId })
        }
      />
    );
  }
  return (
    <TestMarks
      classId={screen.classId}
      className={screen.className}
      testId={screen.testId}
      onBack={() => setScreen({ id: "class", classId: screen.classId, className: screen.className })}
    />
  );
}

function classLabel(c: ClassRow): string {
  return [c.name, c.section].filter(Boolean).join(" ");
}

/** Every class of this school, with how many students are on its roll. */
function ClassesList({ onOpen }: { onOpen: (c: ClassRow) => void }) {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["test", "profile"]);
  const [rows, setRows] = useState<ClassRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx?.schoolId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error: classErr } = await supabase
          .from("classes")
          .select("id, name, section, is_active")
          .eq("school_id", ctx.schoolId)
          .eq("is_active", true)
          .order("name", { ascending: true });
        if (classErr) throw classErr;

        const ids = (data ?? []).map((c) => String(c.id));
        // One read for the roll counts rather than one per class.
        const counts = new Map<string, number>();
        if (ids.length > 0) {
          const { data: students, error: stuErr } = await supabase
            .from("students")
            .select("id, class_id")
            .eq("school_id", ctx.schoolId)
            .is("deleted_at", null)
            .in("class_id", ids);
          if (stuErr) throw stuErr;
          for (const s of students ?? []) {
            const key = String((s as { class_id: string | null }).class_id ?? "");
            if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }

        if (cancelled) return;
        setRows(
          (data ?? []).map((c) => ({
            id: String(c.id),
            name: String(c.name ?? ""),
            section: (c as { section: string | null }).section ?? null,
            students: counts.get(String(c.id)) ?? 0,
          })),
        );
        setError(null);
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, "Could not load the school's classes"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, liveVersion]);

  return (
    <div className="p-8 scroll-y h-full">
      <Label>Tests</Label>
      <SectionHeading>Test results by class</SectionHeading>
      <div className="text-sm text-muted-foreground mb-6">
        Every test a teacher has published, and what each student scored.
      </div>

      {error && <div className="text-sm text-destructive mb-4">{error}</div>}

      <div className="border border-border bg-card max-w-xl">
        <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
          <div className="flex-1">
            <Label>Class</Label>
          </div>
          <div className="w-24 text-right">
            <Label>Students</Label>
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
          rows.map((c) => (
            <button
              key={c.id}
              onClick={() => onOpen(c)}
              className="w-full flex items-center px-4 py-2.5 border-b border-border last:border-b-0 hover:bg-secondary/30 transition-colors text-left"
            >
              <div className="flex-1 text-sm">{classLabel(c)}</div>
              <div className="w-24 text-right font-mono text-sm text-muted-foreground">{c.students}</div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** The tests of one class, newest first, with how many have handed in. */
function ClassTests({
  classId,
  className,
  onBack,
  onOpenTest,
}: {
  classId: string;
  className: string;
  onBack: () => void;
  onOpenTest: (testId: string) => void;
}) {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["test", "profile"]);
  const [tests, setTests] = useState<TestListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await TestService.listForClassDetailed(ctx, classId);
        if (!cancelled) {
          setTests(rows);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, "Could not load this class's tests"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, classId, liveVersion]);

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={onBack} />
      <Label>Tests</Label>
      <SectionHeading>{className}</SectionHeading>
      <div className="text-sm text-muted-foreground mb-6">
        {tests === null ? "Loading…" : `${tests.length} test${tests.length === 1 ? "" : "s"}`}
      </div>

      {error && <div className="text-sm text-destructive mb-4">{error}</div>}

      <div className="border border-border bg-card max-w-2xl">
        <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
          <div className="flex-1">
            <Label>Test</Label>
          </div>
          <div className="w-28">
            <Label>Status</Label>
          </div>
          <div className="w-28 text-right">
            <Label>Handed in</Label>
          </div>
        </div>
        {tests === null ? (
          <>
            <LoadingRow />
            <LoadingRow />
          </>
        ) : tests.length === 0 ? (
          <EmptyState
            title="No tests for this class yet."
            detail="Tests appear here as soon as a teacher creates one."
          />
        ) : (
          tests.map((t) => (
            <button
              key={t.id}
              onClick={() => onOpenTest(t.id)}
              className="w-full flex items-center px-4 py-2.5 border-b border-border last:border-b-0 hover:bg-secondary/30 transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{t.title}</div>
                <div className="text-xs text-muted-foreground">
                  {[
                    t.subject ? displaySubject(t.subject) : null,
                    TEST_KIND_LABELS[(t.test_kind ?? "class_test") as keyof typeof TEST_KIND_LABELS] ??
                      t.test_kind,
                    t.max_mark != null ? `out of ${t.max_mark}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div className="w-28">
                <Pill variant={t.status === "published" ? "default" : "muted"}>{t.status}</Pill>
              </div>
              {/* "7 of 32", not "7": the count alone hides whether the class
                  has sat it. Both halves come from the same RPC. */}
              <div className="w-28 text-right font-mono text-sm text-muted-foreground">
                {t.submitted_count == null ? "—" : `${t.submitted_count} / ${t.roll_count ?? "—"}`}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** One test: the class average, and every student's mark. */
function TestMarks({
  classId,
  className,
  testId,
  onBack,
}: {
  classId: string;
  className: string;
  testId: string;
  onBack: () => void;
}) {
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["test", "profile"]);
  const [marks, setMarks] = useState<TestClassMarks | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await TestService.classMarks(ctx, testId);
        if (!cancelled) {
          setMarks(next);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, "Could not load this test's marks"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, testId, liveVersion]);

  const submitted = (marks?.students ?? []).filter((s) => s.submitted);
  const highest = submitted.length
    ? Math.max(...submitted.map((s) => Number(s.mark ?? 0)))
    : null;
  const lowest = submitted.length ? Math.min(...submitted.map((s) => Number(s.mark ?? 0))) : null;

  // Ranked the same way every other test surface ranks: by mark, and a tie
  // shares a rank. Students who did not sit it are listed after, unranked —
  // they are not last, they are absent (§7: a missing mark is never a 0).
  const ranked = (() => {
    const rows = [...submitted].sort(
      (a, b) => Number(b.mark ?? 0) - Number(a.mark ?? 0) || (a.full_name ?? "").localeCompare(b.full_name ?? ""),
    );
    let lastMark: number | null = null;
    let lastRank = 0;
    return rows.map((s, i) => {
      const mark = Number(s.mark ?? 0);
      const rank = lastMark !== null && mark === lastMark ? lastRank : i + 1;
      lastMark = mark;
      lastRank = rank;
      return { ...s, rank };
    });
  })();
  const absent = (marks?.students ?? []).filter((s) => !s.submitted);

  return (
    <div className="p-8 scroll-y h-full">
      <BackButton onClick={onBack} />
      <Label>
        {className} · Tests
      </Label>
      <SectionHeading>{marks?.title ?? "Test"}</SectionHeading>
      <div className="text-sm text-muted-foreground mb-6">
        {marks
          ? [
              marks.subject ? displaySubject(marks.subject) : null,
              marks.max_mark != null ? `out of ${marks.max_mark}` : null,
              `${marks.submitted_count} of ${marks.students.length} handed in`,
            ]
              .filter(Boolean)
              .join(" · ")
          : "Loading…"}
      </div>

      {error && <div className="text-sm text-destructive mb-4">{error}</div>}

      <div className="grid grid-cols-3 gap-4 mb-8 max-w-xl">
        {[
          { label: "Class average", value: marks?.class_average },
          { label: "Highest", value: highest },
          { label: "Lowest", value: lowest },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border p-4">
            <Label className="block mb-2">{s.label}</Label>
            {/* NULL, not 0, when nobody has sat it: a real average of 0 and an
                unsat test are different facts and must not render the same. */}
            <div className="font-mono text-2xl">{toCountLabel(s.value ?? null)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {marks?.max_mark != null ? `of ${marks.max_mark}` : ""}
            </div>
          </div>
        ))}
      </div>

      <Label className="block mb-3">All students</Label>
      <div className="border border-border bg-card max-w-xl">
        <div className="flex items-center px-4 py-2 border-b border-border bg-secondary/40">
          <div className="w-8">
            <Label>#</Label>
          </div>
          <div className="w-12">
            <Label>Roll</Label>
          </div>
          <div className="flex-1">
            <Label>Student</Label>
          </div>
          <div className="w-24 text-right">
            <Label>Marks</Label>
          </div>
        </div>
        {marks === null ? (
          <>
            <LoadingRow />
            <LoadingRow />
            <LoadingRow />
          </>
        ) : marks.students.length === 0 ? (
          <EmptyState title="No students on this class's roll." />
        ) : (
          <>
            {ranked.map((s) => (
              <div
                key={s.student_id}
                className="flex items-center px-4 py-2.5 border-b border-border last:border-b-0"
              >
                <div className="w-8 font-mono text-xs text-muted-foreground">{s.rank}</div>
                <div className="w-12 font-mono text-xs text-muted-foreground">
                  {s.roll_number ?? "—"}
                </div>
                <div className="flex-1 text-sm truncate">
                  {toPersonName(s.full_name, { kind: "student" })}
                </div>
                <div className="w-24 text-right font-mono text-sm">
                  {s.mark}
                  {marks.max_mark != null ? (
                    <span className="text-muted-foreground"> / {marks.max_mark}</span>
                  ) : null}
                </div>
              </div>
            ))}
            {absent.map((s) => (
              <div
                key={s.student_id}
                className="flex items-center px-4 py-2.5 border-b border-border last:border-b-0"
              >
                <div className="w-8 font-mono text-xs text-muted-foreground">—</div>
                <div className="w-12 font-mono text-xs text-muted-foreground">
                  {s.roll_number ?? "—"}
                </div>
                <div className="flex-1 text-sm truncate text-muted-foreground">
                  {toPersonName(s.full_name, { kind: "student" })}
                </div>
                <div className="w-24 text-right text-xs text-muted-foreground">Not submitted</div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Said plainly rather than left as a gap the principal wonders about. */}
      <div className="text-xs text-muted-foreground mt-4 max-w-xl">
        Marks only. Which questions a student got wrong is theirs and their teacher&apos;s.
      </div>
    </div>
  );
}
