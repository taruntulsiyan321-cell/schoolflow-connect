import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Timer, Play, ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  EmptyState, GlassCard, PageHeader, PageSkeleton, SkeletonList, SubjectBadge, cn,
} from "@/gurukul/components/shared";
import { PlanLimitNotice } from "@/gurukul/components/PlanLimitNotice";
import {
  planLimitFromDecision, usesLeftFromDecision, PlanLimitError, type PlanLimit,
} from "@/lib/premium";
import {
  fetchMockCatalog, fetchMockHistory, formatCountdown, marksSentence, notEnoughYet,
  remainingMs, startMock, MockError,
  type MockCatalog, type MockHistoryRow, type MockPaperShape, type MockSubjectSupply,
} from "@/lib/mockTest";
import { formatSessionDuration } from "@/lib/practiceSessionStats";
import { displaySubject } from "@/lib/academicDisplay";
import { toErrorMessage } from "@/lib/presentation";
import { pluralise } from "@/lib/plural";
import { LOADING_LIST, type ListState } from "@/lib/listState";

/**
 * Mock Tests — a full CUET paper, one domain subject at a time.
 *
 * Every rule on this screen is the server's (20261115000000): how long the
 * paper is, what it marks at, which subjects can fill one, and whether the plan
 * allows another. Nothing here restates them — `catalog.paper` carries the
 * shape and `catalog.plan` carries the decision, so this file cannot disagree
 * with the database about what a mock test is.
 *
 * A subject that cannot fill a paper is SHOWN, with its counts, rather than
 * hidden: "22 of 50 questions ready, from 3 chapters" tells a student the bank
 * is being filled in; a subject that silently vanishes tells them nothing.
 */
export default function MockTests() {
  const nav = useNavigate();
  const [catalog, setCatalog] = useState<MockCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ListState<MockHistoryRow>>(LOADING_LIST);
  const [starting, setStarting] = useState<string | null>(null);
  /** A refusal the server gave when a start was actually attempted. Kept apart
   *  from the catalog's own decision so a later read cannot quietly drop it off
   *  the screen. */
  const [refusal, setRefusal] = useState<PlanLimit | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setError(null);
    try {
      setCatalog(await fetchMockCatalog());
      setRefusal(null);
    } catch (e) {
      setError(toErrorMessage(e, "Could not load mock tests"));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rows = await fetchMockHistory();
        if (alive) setHistory({ status: "ready", items: rows });
      } catch (e) {
        if (alive) setHistory({ status: "failed", message: toErrorMessage(e, "Could not load your papers") });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** The open paper's clock, so "time left" is not stale on screen. */
  const open = catalog?.individual ? catalog.open : null;
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  const paper: MockPaperShape | null = catalog?.paper ?? null;
  const planLimit = useMemo(
    () => refusal ?? (catalog?.individual ? planLimitFromDecision(catalog.plan) : null),
    [catalog, refusal],
  );
  const left = useMemo(
    () => (catalog?.individual ? usesLeftFromDecision("mock_test.start", catalog.plan) : null),
    [catalog],
  );

  const start = async (s: MockSubjectSupply) => {
    if (!paper) return;
    const ok = window.confirm(
      `Start a ${displaySubject(s.subject) || s.subject} mock test?\n\n` +
        `${paper.questions} questions, ${paper.minutes} minutes, one attempt. ` +
        `${marksSentence(paper)}\n\n` +
        "The clock does not stop once it starts.",
    );
    if (!ok) return;
    setStarting(s.subject);
    try {
      const started = await startMock(s.subject);
      nav(`/student/mock/${started.id}`);
    } catch (e) {
      if (e instanceof PlanLimitError) {
        // The plan refused it, so nothing started and nothing was counted:
        // there is nothing to re-read, and re-reading would replace this
        // refusal with the catalog's own copy of the same decision.
        setRefusal(e.planLimit);
      } else if (e instanceof MockError) {
        toast.error(e.message);
        void load();
      } else {
        toast.error(toErrorMessage(e, "Could not start the paper"));
      }
    } finally {
      setStarting(null);
    }
  };

  if (!catalog && !error) {
    return (
      <PageSkeleton label="Loading mock tests" className="space-y-6">
        <SkeletonList rows={3} />
      </PageSkeleton>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader eyebrow="CUET" title="Mock Tests" />
        <EmptyState
          icon={<AlertCircle className="w-6 h-6" />}
          title="Could not load mock tests"
          sub={error}
          action={() => void load()}
          actionLabel="Try again"
        />
      </div>
    );
  }

  if (catalog && !catalog.individual) {
    return (
      <div>
        <PageHeader eyebrow="CUET" title="Mock Tests" />
        <EmptyState
          icon={<Timer className="w-6 h-6" />}
          title="Mock tests are for exam accounts"
          sub="A full CUET paper belongs to an exam account. Your practice and your school's tests are on their own screens."
        />
      </div>
    );
  }

  if (!catalog?.individual || !paper) return null;

  return (
    <div>
      <PageHeader
        eyebrow="CUET"
        title="Mock Tests"
        subtitle={`${paper.questions} questions in ${paper.minutes} minutes, one domain subject. ${marksSentence(paper)}`}
      />

      {planLimit && <PlanLimitNotice limit={planLimit} className="mb-4" />}
      {!planLimit && left && (
        <p className="mb-4 text-xs text-muted-foreground" data-testid="mock-uses-left">{left.note}</p>
      )}

      {open && (
        <GlassCard className="mb-6 p-5" glow="purple">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Paper in progress</div>
              <div className="mt-1 flex items-center gap-2">
                <SubjectBadge subject={displaySubject(open.subject) || open.subject} />
                <span className="font-mono text-sm font-semibold" data-testid="mock-open-clock">
                  {formatCountdown(remainingMs(open.deadline, now))} left
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => nav(`/student/mock/${open.id}`)}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Resume <ArrowRight className="ml-1 inline h-4 w-4" />
            </button>
          </div>
        </GlassCard>
      )}

      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">Subjects</h2>
      {catalog.subjects.length === 0 ? (
        <EmptyState
          icon={<Timer className="w-6 h-6" />}
          title="No subjects yet"
          sub="Your exam syllabus has no questions in the bank yet. Mock tests will appear here as it fills."
          variant="section"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {catalog.subjects.map((s) => {
            const label = displaySubject(s.subject) || s.subject;
            return (
              <GlassCard key={s.subject} className="p-4">
                <div className="flex items-start justify-between gap-3" data-testid="mock-subject">
                  <div className="min-w-0">
                    <SubjectBadge subject={label} />
                    {s.ready ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {paper.questions} questions from {pluralise(s.chapters, "chapter")}, {paper.minutes} minutes.
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground" data-testid="mock-not-ready">
                        Not enough questions yet — {notEnoughYet(s, paper)}
                      </p>
                    )}
                  </div>
                  {s.ready ? (
                    <button
                      type="button"
                      disabled={!!starting || !!open}
                      onClick={() => void start(s)}
                      title={open ? "Finish the paper you have open first" : undefined}
                      className={cn(
                        "shrink-0 rounded-xl px-3 py-2 text-xs font-semibold",
                        starting || open
                          ? "cursor-not-allowed bg-muted text-muted-foreground"
                          : "bg-primary text-primary-foreground hover:bg-primary/90",
                      )}
                    >
                      <Play className="mr-1 inline h-3.5 w-3.5" />
                      {starting === s.subject ? "Starting…" : "Start"}
                    </button>
                  ) : (
                    <span className="shrink-0 rounded-lg border border-border px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Not ready
                    </span>
                  )}
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      <h2 className="mb-3 mt-8 text-sm font-bold uppercase tracking-wider text-muted-foreground">Your papers</h2>
      {history.status === "loading" && <SkeletonList rows={2} />}
      {history.status === "failed" && (
        <EmptyState
          icon={<AlertCircle className="w-6 h-6" />}
          title="Could not load your papers"
          sub={history.message}
          variant="section"
        />
      )}
      {history.status === "ready" && history.items.length === 0 && (
        <EmptyState
          icon={<CheckCircle2 className="w-6 h-6" />}
          title="No papers yet"
          sub="Sit one and it will be here with your score and a question-by-question review."
          variant="section"
        />
      )}
      {history.status === "ready" && history.items.length > 0 && (
        <div className="space-y-2" data-testid="mock-history">
          {history.items.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => nav(`/student/mock/${h.id}/result`)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 text-left hover:bg-card"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">
                  {displaySubject(h.subject) || h.subject}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(h.submitted_at).toLocaleDateString()} ·{" "}
                  {h.correct} right, {h.wrong} wrong, {h.unanswered} left
                  {h.voided > 0 ? `, ${h.voided} withdrawn` : ""}
                  {h.seconds_taken != null ? ` · ${formatSessionDuration(h.seconds_taken * 1000)}` : ""}
                  {h.auto_submitted ? " · time ran out" : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-lg font-black leading-none text-foreground">{h.score}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">of {h.max_score}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
