import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { withAlpha } from "@/lib/colorAlpha";
import {
  RecoveryEngineService,
  useAcademicContext,
  type RecoveryQueueRow,
} from "@/academic";
import { displayChapter, displaySubject } from "@/lib/academicDisplay";
import { isPlaceholderAcademicLabel } from "@/academic/taxonomy";
import {
  GlassCard, NoStudentProfile, PageHeader, PageSkeleton, ProgressBar,
  Skeleton, SkeletonCard, SkeletonList, SkeletonStats, SubjectBadge, cn,
} from "@/gurukul/components/shared";
import {
  RefreshCw, AlertCircle, CheckCircle2, BookOpen, Search, Play, Loader2,
} from "lucide-react";
import { toErrorMessage } from "@/lib/presentation";
import { pluralise } from "@/lib/plural";

/**
 * Recovery — the 7C engine, and nothing else.
 *
 * ── WHAT THIS REPLACED ────────────────────────────────────────────────────
 *
 * The previous screen was built on recovery_assignments: rows the OLD engine
 * created on the FIRST wrong answer in a concept, keyed on free-text chapter
 * and concept names. Measured before replacing it, 2026-09-13:
 *
 *   17 pending assignments, across 2 users, ALL with questions_completed = 0
 *   sizes of 1, 1, 1, 2, 3, 3, 3 questions — one wrong answer each
 *
 * Nobody was mid-flow. They were stubs left by a trigger that fired far too
 * eagerly, which is exactly what RECOVERY_TRIGGER_COUNT (5) exists to stop.
 *
 * The new engine works on CHAPTERS (§2 — chapter_id, never a name), triggers
 * at five open mistakes, and builds the §4.2 ladder bank-first. This screen
 * reads rpc_student_recovery_queue and starts sessions through
 * rpc_start_recovery_session.
 *
 * ── CHAPTERS BELOW THE TRIGGER ARE SHOWN, NOT HIDDEN ──────────────────────
 *
 * chapter_state rows only exist once a chapter has already reached the
 * trigger. Measured live: ONE chapter in the whole database had. A screen
 * reading only those would show one card.
 *
 * So the queue reads from the mistake book and shows every chapter with an
 * open mistake, each carrying how close it is — "2 of 5". For the same
 * student that is seven cards instead of one, and the count is something they
 * can watch move. `ready` and `trigger_count` are both decided server-side;
 * this file holds no copy of the threshold (§10 item 7).
 */

type QueueItem = RecoveryQueueRow & {
  chapterLabel: string;
  subjectLabel: string;
};

function toItem(r: RecoveryQueueRow): QueueItem | null {
  const rawChapter = r.chapter;
  if (!rawChapter || isPlaceholderAcademicLabel(rawChapter)) return null;
  const subject = r.subject && !isPlaceholderAcademicLabel(r.subject) ? r.subject : "";
  return {
    ...r,
    chapterLabel: displayChapter(rawChapter) || rawChapter,
    subjectLabel: subject ? displaySubject(subject) || subject : "",
  };
}

function StateTag({ item }: { item: QueueItem }) {
  // §3.2 vocabulary, shown only where it tells the student something they can
  // act on. "has_mistakes" is the default state and says nothing a card
  // already showing an open-mistake count does not, so it renders nothing.
  if (item.in_recovery) {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300">
        In recovery
      </span>
    );
  }
  if (item.state === "revision_failed") {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-300">
        Revision failed
      </span>
    );
  }
  if (item.state === "recovered") {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
        Recovered
      </span>
    );
  }
  return null;
}

function RecoveryCard({
  item, onStart, onPractise, starting,
}: {
  item: QueueItem;
  onStart: () => void;
  onPractise: () => void;
  starting: boolean;
}) {
  const pct = Math.min(100, Math.round((item.open_mistakes / item.trigger_count) * 100));
  const accent = item.ready ? "hsl(var(--destructive))" : "hsl(var(--warning))";

  return (
    <GlassCard className="p-4 hover:border-border transition-all">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {item.subjectLabel && <SubjectBadge subject={item.subjectLabel} />}
            <StateTag item={item} />
            {item.rounds_taken > 0 && (
              <span className="text-[10px] text-muted-foreground">
                round {item.rounds_taken + 1}
              </span>
            )}
          </div>
          <div className="text-sm font-bold text-foreground truncate">{item.chapterLabel}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xl font-black tabular-nums" style={{ color: accent }}>
            {item.open_mistakes}
          </div>
          <div className="text-[9px] text-muted-foreground">
            open {pluralise(item.open_mistakes, "mistake", "mistakes")}
          </div>
        </div>
      </div>

      {item.ready ? (
        <>
          {/* §4.4 — a readiness quoted back only when one was actually
              recorded. Null means no recovery has been taken, which is a
              different statement from a readiness of zero. */}
          {item.last_recovery_readiness != null && (
            <p className="text-[11px] text-muted-foreground mb-2">
              Last cleared at {Math.round(item.last_recovery_readiness * 100)}% readiness.
            </p>
          )}
          <button
            onClick={onStart}
            disabled={starting}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/15 border border-rose-500/25 text-rose-300 text-xs font-bold hover:bg-rose-500/25 transition-all disabled:opacity-50"
          >
            {starting
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Building your session…</>
              : <><Play className="w-3 h-3" /> Start recovery</>}
          </button>
        </>
      ) : (
        <>
          <div className="mb-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>{item.open_mistakes} of {item.trigger_count} before recovery opens</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <ProgressBar value={pct} color={accent} />
          </div>
          {/* §4.1: fewer than the trigger is not worth a session — "clearing a
              one-mistake chapter creates a false sense of progress". So the
              offer here is ordinary practice, not a recovery session. */}
          <button
            onClick={onPractise}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-muted border border-border text-xs font-semibold text-muted-foreground hover:bg-secondary transition-all"
          >
            <BookOpen className="w-3 h-3" /> Practise this chapter
          </button>
        </>
      )}
    </GlassCard>
  );
}

export default function Recovery() {
  const navigate = useNavigate();
  const { ctx, ready: academicReady } = useAcademicContext();

  const [rows, setRows] = useState<RecoveryQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!academicReady || !ctx) return;
    let cancelled = false;
    setLoading(true);
    RecoveryEngineService.getRecoveryQueue(ctx)
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setError(null);
      })
      .catch((e) => {
        // No silent fallback: a swallowed failure here is indistinguishable
        // from a student with nothing to recover.
        if (!cancelled) setError(toErrorMessage(e, "Could not load recovery"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [ctx, academicReady, nonce]);

  const items = useMemo(
    () => rows.map(toItem).filter((r): r is QueueItem => r !== null),
    [rows],
  );

  async function startRecovery(item: QueueItem) {
    if (!ctx) return;
    setStartingId(item.chapter_id);
    try {
      const res = await RecoveryEngineService.startRecoverySession(ctx, item.chapter_id);
      if (!res.started) {
        // §4.1a treats "offer nothing and try again later" as a correct
        // outcome, so the reason is shown rather than thrown.
        toast.message(res.reason);
        reload();
        return;
      }
      // §4.2a — a session that could not be filled runs short and SAYS SO.
      // Measured live: with no variants in the bank, tiers 1 and 2 cannot
      // fill, so this fires on every session until generation runs.
      if (!res.complete) {
        toast.message(
          `Starting with ${res.session_size} ${pluralise(res.session_size, "question", "questions")} — ${res.shortfall} more are still being written for this chapter.`,
        );
      }
      // The ladder travels in router state: it is a map of question ids that
      // is not stored server-side, so it cannot be re-derived from a URL.
      navigate("/student/practice", {
        state: {
          recovery: {
            sessionId: res.session_id,
            chapterId: item.chapter_id,
            tierByQuestionId: res.tierByQuestionId,
            complete: res.complete,
            shortfall: res.shortfall,
          },
        },
      });
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not start recovery"));
    } finally {
      setStartingId(null);
    }
  }

  function practiseChapter(item: QueueItem) {
    const qs = new URLSearchParams();
    qs.set("chapter", item.chapterLabel);
    if (item.subjectLabel) qs.set("subject", item.subjectLabel);
    navigate(`/student/practice?${qs.toString()}`);
  }

  const header = (
    <PageHeader
      eyebrow="Learning"
      title="Recovery"
      subtitle="Chapters where mistakes are piling up, and what to do about them."
    />
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {header}
        <PageSkeleton label="Loading recovery" className="space-y-6">
          <SkeletonStats count={3} />
          <SkeletonCard className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Skeleton className="w-7 h-7 rounded-lg" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
            <SkeletonList rows={3} />
          </SkeletonCard>
        </PageSkeleton>
      </div>
    );
  }

  if (!academicReady) {
    return <div className="space-y-6">{header}<NoStudentProfile /></div>;
  }

  if (error) {
    return (
      <div className="space-y-6">
        {header}
        <GlassCard className="p-8 text-center">
          <AlertCircle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Could not load recovery</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
        </GlassCard>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (t) =>
          t.chapterLabel.toLowerCase().includes(q) ||
          t.subjectLabel.toLowerCase().includes(q),
      )
    : items;

  const readyCount = items.filter((t) => t.ready).length;
  const openTotal = items.reduce((a, t) => a + t.open_mistakes, 0);
  const roundsTotal = items.reduce((a, t) => a + t.rounds_taken, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Learning"
        title="Recovery"
        subtitle="Chapters where mistakes are piling up, and what to do about them."
        action={
          readyCount > 0 ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
              <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
              <span className="text-xs font-bold text-rose-400">
                {readyCount} ready
              </span>
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Chapters", value: items.length, color: "hsl(var(--warning))", icon: <RefreshCw className="w-4 h-4" /> },
          { label: "Open mistakes", value: openTotal, color: "hsl(var(--destructive))", icon: <BookOpen className="w-4 h-4" /> },
          { label: "Sessions done", value: roundsTotal, color: "hsl(var(--success))", icon: <CheckCircle2 className="w-4 h-4" /> },
        ].map((s) => (
          <GlassCard key={s.label} className="p-4">
            <div className="flex items-center gap-2 mb-2" style={{ color: s.color }}>
              {s.icon}
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</span>
            </div>
            <div className="text-2xl font-black tabular-nums" style={{ color: s.color }}>{s.value}</div>
          </GlassCard>
        ))}
      </div>

      {items.length === 0 ? (
        <GlassCard className="p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground">Nothing to recover</p>
          <p className="text-xs text-muted-foreground mt-1">
            Mistakes you make in practice collect here by chapter. Recovery opens once a
            chapter has enough of them to be worth a session.
          </p>
        </GlassCard>
      ) : (
        <>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chapters"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface/60 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-border"
            />
          </div>

          {filtered.length === 0 ? (
            <GlassCard className="p-8 text-center">
              <p className="text-sm text-muted-foreground">No chapters match that search</p>
            </GlassCard>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {filtered.map((item) => (
                <RecoveryCard
                  key={item.chapter_id}
                  item={item}
                  starting={startingId === item.chapter_id}
                  onStart={() => void startRecovery(item)}
                  onPractise={() => practiseChapter(item)}
                />
              ))}
            </div>
          )}

          {readyCount === 0 && (
            <GlassCard
              className="p-4 text-center"
              style={{ borderColor: withAlpha("hsl(var(--warning))", 0.2) }}
            >
              <p className={cn("text-xs text-muted-foreground")}>
                No chapter has reached {items[0]?.trigger_count} open mistakes yet. Keep
                practising — recovery opens by itself when one does.
              </p>
            </GlassCard>
          )}
        </>
      )}
    </div>
  );
}
