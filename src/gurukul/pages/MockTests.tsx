import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Timer, Play, ArrowRight, AlertCircle, CheckCircle2, ChevronDown } from "lucide-react";
import {
  EmptyState, GlassCard, PageHeader, PageSkeleton, SkeletonList, SubjectBadge, cn,
} from "@/gurukul/components/shared";
import { PlanLimitNotice } from "@/gurukul/components/PlanLimitNotice";
import {
  planLimitFromDecision, usesLeftFromDecision, PlanLimitError, type PlanLimit,
} from "@/lib/premium";
import {
  fetchMockCatalog, fetchMockHistory, formatCountdown, formsSentence, marksSentence, notEnoughYet,
  prepareMock, remainingMs, seenBeforeSentence, setExamOption, shortSentence, startMock, MockError,
  type MockCatalog, type MockChapter, type MockHistoryRow, type MockPaperShape, type MockPreview, type MockSubject,
} from "@/lib/mockTest";
import { formatSessionDuration } from "@/lib/practiceSessionStats";
import { displaySubject } from "@/lib/academicDisplay";
import { toErrorMessage } from "@/lib/presentation";
import { LOADING_LIST, type ListState } from "@/lib/listState";

/**
 * Mock Tests — a CUET paper built like the real one (TODO B): a whole subject,
 * spread across its chapters and question forms by the approved blueprint, or
 * one chapter of 50 questions.
 *
 * Every rule on this screen is the server's (20261115000000, 20261150000000):
 * how long a paper is, what it marks at, how it spreads, which subjects and
 * chapters can fill one, which paper a student is given and whether the plan
 * allows another. Nothing here restates them.
 *
 * A paper is PREPARED before it starts, so the student reads what it holds —
 * how many of its questions they have seen, a chapter that came up short, forms
 * the bank does not hold yet — before the clock starts and before the plan
 * counts it.
 *
 * A subject or chapter that cannot fill a paper is SHOWN, with its count, rather
 * than hidden: "22 of 50 questions ready" says the bank is being filled; a card
 * that silently vanishes says nothing.
 */
export default function MockTests() {
  const nav = useNavigate();
  const [catalog, setCatalog] = useState<MockCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ListState<MockHistoryRow>>(LOADING_LIST);
  /** The paper being prepared or started, by subject and chapter. */
  const [starting, setStarting] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
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

  const choose = async (s: MockSubject, group: string, option: string) => {
    setChoosing(`${s.subject}:${group}`);
    try {
      await setExamOption(s.subject, group, option);
      await load();
    } catch (e) {
      toast.error(e instanceof MockError ? e.message : toErrorMessage(e, "Could not save your choice"));
    } finally {
      setChoosing(null);
    }
  };

  /** Prepare the paper, say what it holds, and start it only if the student still wants to. */
  const begin = async (s: MockSubject, chapter: MockChapter | null) => {
    const key = `${s.subject}:${chapter?.chapter_id ?? "all"}`;
    setStarting(key);
    try {
      const p: MockPreview = await prepareMock(s.subject, chapter?.chapter_id ?? null);
      const title = p.chapter
        ? `${p.chapter} — a chapter paper`
        : `${displaySubject(p.subject) || p.subject}${p.options.length ? ` (${p.options.map((o) => o.label).join(", ")})` : ""}`;
      const lines = [
        `Start ${title}?`,
        `${p.total} questions, ${p.minutes} minutes, one attempt. ${marksSentence(p)}`,
        seenBeforeSentence(p),
        shortSentence(p.short),
        formsSentence(p),
        "The clock does not stop once it starts.",
      ].filter((l): l is string => Boolean(l));
      if (!window.confirm(lines.join("\n\n"))) return;
      const started = await startMock(p.paper_id);
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
  const busy = Boolean(starting) || Boolean(open);

  return (
    <div>
      <PageHeader
        eyebrow="CUET"
        title="Mock Tests"
        subtitle={`${paper.questions} questions in ${paper.minutes} minutes, built like the real paper — a whole subject or one chapter. ${marksSentence(paper)}`}
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
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <SubjectBadge subject={displaySubject(open.subject) || open.subject} />
                {open.chapter && <span className="text-xs text-muted-foreground">{open.chapter}</span>}
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
        <div className="space-y-3">
          {catalog.subjects.map((s) => (
            <SubjectCard
              key={s.subject}
              subject={s}
              paper={paper}
              busy={busy}
              open={Boolean(open)}
              starting={starting}
              choosing={choosing}
              onChoose={(group, option) => void choose(s, group, option)}
              onBegin={(chapter) => void begin(s, chapter)}
            />
          ))}
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
          sub="Sit one and it will be here with your score and the same analysis a practice session has."
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
                  {displaySubject(h.subject) || h.subject}{h.chapter ? ` · ${h.chapter}` : ""}
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

function StartButton({ label, disabled, title, onClick, testId }: {
  label: string; disabled: boolean; title?: string; onClick: () => void; testId?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      data-testid={testId}
      className={cn(
        "shrink-0 rounded-xl px-3 py-2 text-xs font-semibold",
        disabled ? "cursor-not-allowed bg-muted text-muted-foreground" : "bg-primary text-primary-foreground hover:bg-primary/90",
      )}
    >
      <Play className="mr-1 inline h-3.5 w-3.5" />
      {label}
    </button>
  );
}

/** One subject: its once-only choice, its whole-subject paper, and its chapter papers. */
function SubjectCard({ subject: s, paper, busy, open, starting, choosing, onChoose, onBegin }: {
  subject: MockSubject;
  paper: MockPaperShape;
  busy: boolean;
  open: boolean;
  starting: string | null;
  choosing: string | null;
  onChoose: (group: string, option: string) => void;
  onBegin: (chapter: MockChapter | null) => void;
}) {
  const label = displaySubject(s.subject) || s.subject;
  const unchosen = s.options.filter((o) => !o.chosen);
  const readyChapters = s.chapters.filter((c) => c.ready).length;
  const blockedTitle = open ? "Finish the paper you have open first" : undefined;

  return (
    <GlassCard className="p-4">
      <div data-testid="mock-subject">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SubjectBadge subject={label} />
          <span className="text-xs text-muted-foreground">{s.questions} questions for mocks</span>
        </div>

        {s.options.map((o) => (
          <div key={o.group} className="mt-3" data-testid="mock-option">
            <div className="mb-1.5 text-xs font-semibold text-foreground">
              Your {o.label}{o.chosen ? "" : " — choose once, every paper follows it"}
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Your ${o.label}`}>
              {o.choices.map((c) => (
                <button
                  key={c.option}
                  type="button"
                  aria-pressed={o.chosen === c.option}
                  disabled={choosing === `${s.subject}:${o.group}`}
                  onClick={() => o.chosen !== c.option && onChoose(o.group, c.option)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all",
                    o.chosen === c.option
                      ? "border-primary/40 bg-primary/15 text-foreground"
                      : "border-border bg-muted text-muted-foreground hover:bg-secondary",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-3 flex items-start justify-between gap-3 border-t border-border/60 pt-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">Whole-subject paper</div>
            {s.ready ? (
              <p className="text-xs text-muted-foreground">
                {paper.questions} questions across the chapters as the real paper spreads them, {paper.minutes} minutes.
              </p>
            ) : unchosen.length > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="mock-needs-choice">
                Choose your {unchosen.map((o) => o.label).join(" and ")} first.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="mock-not-ready">
                Not enough questions yet — {notEnoughYet(s.questions, paper)}
              </p>
            )}
          </div>
          {s.ready ? (
            <StartButton
              label={starting === `${s.subject}:all` ? "Preparing…" : "Start"}
              disabled={busy}
              title={blockedTitle}
              onClick={() => onBegin(null)}
              testId="mock-start-subject"
            />
          ) : (
            <span className="shrink-0 rounded-lg border border-border px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Not ready
            </span>
          )}
        </div>

        {s.chapters.length > 0 && (
          <details className="group mt-3 border-t border-border/60 pt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-foreground">
              <span>Chapter papers <span className="font-normal text-muted-foreground">· {readyChapters} of {s.chapters.length} ready</span></span>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="mt-2 divide-y divide-border/50" data-testid="mock-chapters">
              {s.chapters.map((c) => (
                <li key={c.chapter_id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-foreground">{c.chapter}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.ready ? `${paper.questions} questions from this chapter, ${paper.minutes} minutes` : notEnoughYet(c.questions, paper)}
                    </div>
                  </div>
                  {c.ready ? (
                    <StartButton
                      label={starting === `${s.subject}:${c.chapter_id}` ? "Preparing…" : "Start"}
                      disabled={busy}
                      title={blockedTitle}
                      onClick={() => onBegin(c)}
                    />
                  ) : (
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">Not ready</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </GlassCard>
  );
}
