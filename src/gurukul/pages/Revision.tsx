import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { RecoveryEngineService, useAcademicContext } from "@/academic";
import { useRevisionItems, useRevisionHistory, type RevItem } from "./useRevisionQueueV2";
import { useGurukulStudent } from "@/gurukul/StudentContext";
import { displayChapter } from "@/lib/academicDisplay";
import { REVISION_ENGAGEMENT_MIN, REVISION_INTERVALS_DAYS } from "@/academic/recovery/constants";
import { listItems } from "@/lib/listState";
import { GlassCard, NoStudentProfile, PageHeader, PageSkeleton, ProgressRing, Skeleton, SkeletonCard, SkeletonList, SubjectBadge, cn } from "@/gurukul/components/shared";
import {
  RotateCcw, CheckCircle2, AlertCircle, Flame, History,
  Play, Zap
} from "lucide-react";
import { toErrorMessage } from "@/lib/presentation";

function DueTag({ dueIn }: { dueIn: string }) {
  const cfg =
    dueIn === "Now" ? { color:"hsl(var(--destructive))", bg:"rgba(244,63,94,0.12)", label:"Now" } :
    dueIn === "Today" ? { color:"hsl(var(--warning))", bg:"rgba(245,158,11,0.12)", label:"Today" } :
    dueIn === "Tomorrow" ? { color:"hsl(var(--warning))", bg:"rgba(251,146,60,0.12)", label:"Tomorrow" } :
    dueIn === "Done" ? { color:"hsl(var(--success))", bg:"rgba(52,211,153,0.12)", label:"Done" } :
    { color:"hsl(var(--primary))", bg:"rgba(167,139,250,0.12)", label:dueIn };
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{color:cfg.color,background:cfg.bg}}>
      {cfg.label}
    </span>
  );
}

function RevItemCard({
  item, onRevise, onCheck, busy,
}: {
  item: RevItem;
  onRevise: () => void;
  onCheck: () => void;
  /** The check's contents are being fetched from the server. */
  busy: boolean;
}) {
  const chapterLabel = displayChapter(item.chapter) || item.chapter;
  return (
    <GlassCard className="p-4 hover:border-border transition-all">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <DueTag dueIn={item.dueIn}/>
            <SubjectBadge subject={item.subject}/>
            {/* §5.3 made visible. The old queue had no stages to show: every
                row was simply due today, so there was no ladder to be on. */}
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">
              Check {Math.min(item.passes + 1, item.stagesToSolid)} of {item.stagesToSolid}
            </span>
            {item.state === "revision_failed" && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-300">
                Restarted
              </span>
            )}
            {item.openMistakes > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {item.openMistakes} open {item.openMistakes === 1 ? "mistake" : "mistakes"}
              </span>
            )}
          </div>
          {/* One line: the chapter. The card used to print the chapter as a
              "concept" title and then again beneath it whenever the two
              spellings differed — they were the same field, so the second line
              was either a duplicate or a lone dash. */}
          <div className="text-sm font-bold text-foreground">{chapterLabel}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button onClick={onRevise}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-300 text-xs font-bold hover:bg-violet-500/30 transition-all">
          <Play className="w-3 h-3"/> Practice topic
        </button>
        {/* DISABLED WHEN THERE IS NOTHING TO CHECK ON. The note below already
            said "nothing new left in this chapter" and the button stayed live
            beside it — so the student took the check anyway, answered every
            question, and rpc_submit_revision_session threw the sitting away
            for having no unseen half (§5.4). Measured live on two chapters,
            at 80% and 100%.
            `freshAvailable` is rpc_student_revision_queue's own count, not a
            rule restated in the browser: the server decides what a check
            needs and this reflects the answer. */}
        <button onClick={onCheck} disabled={busy || item.freshAvailable === 0}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold transition-all",
            busy || item.freshAvailable === 0 ? "opacity-60 cursor-not-allowed" : "hover:bg-emerald-500/20",
          )}>
          <CheckCircle2 className="w-3 h-3"/> {busy ? "Building your check…" : "Take the check"}
        </button>
        {/* Said BEFORE the student commits, not after. A chapter whose bank
            this student has worked through cannot give a full-length check,
            and finding that out at question four is worse than knowing now. */}
        {item.freshAvailable === 0 ? (
          <span className="text-[10px] text-muted-foreground">
            nothing new left in this chapter
          </span>
        ) : item.freshAvailable < item.stagesToSolid ? (
          <span className="text-[10px] text-muted-foreground">
            only {item.freshAvailable} new {item.freshAvailable === 1 ? "question" : "questions"} left here
          </span>
        ) : null}
      </div>
    </GlassCard>
  );
}

export default function Revision() {
  const navigate = useNavigate();
  const student = useGurukulStudent();
  const { ctx, ready: academicReady, settled: academicSettled } = useAcademicContext();
  const [filter, setFilter] = useState<"all"|"due"|"upcoming">("all");
  const [subjectTab, setSubjectTab] = useState("all");
  /**
   * The chapter whose check is being built, so the button can say so.
   * Building a check is a round trip now — it asks the server which questions
   * this student has never seen — and a button that looks idle while that runs
   * gets pressed twice.
   */
  const [startingId, setStartingId] = useState<string | null>(null);

  // useStudentAcademicSnapshot is gone from this screen. It was here only to
  // supply snapshot.revision_queue, and that queue is retired — every row in
  // it was due CURRENT_DATE because nothing applied the §5.3 intervals. The
  // engine hook below owns this screen's loading and error states now, so the
  // page no longer waits on a snapshot it reads nothing else from.
  const { items, reload } = useRevisionItems(ctx, academicReady, academicSettled);
  const REVISION_ITEMS = listItems(items);
  // Its own state, deliberately: a history that fails to load must not blank
  // the queue the student came here to work through.
  const { history, reload: reloadHistory } = useRevisionHistory(ctx, academicReady, academicSettled);
  // Study streak SSOT: Progression via shell (same as Home) — not raw snapshot xp.
  const streak = student.streak;

  /**
   * Start the §5.4 check for a chapter.
   *
   * This replaces a "Mark done" button that called rpc_complete_revision and
   * closed the item with no questions asked. §5.5 defines a revision as a
   * score against REVISION_PASS_THRESHOLD, and §7 is explicit that the design
   * catches a student who clears without learning rather than trusting them —
   * so a button that completed a revision by being pressed was the whole
   * anti-gaming section defeated by a click.
   *
   * ── THE CONTENTS ARE FETCHED, NOT IMPLIED BY A LINK ───────────────────
   *
   * This used to navigate to /student/practice?revision=<uuid> and let the
   * ordinary question loader pick by chapter. That loader cannot exclude
   * questions the student has already seen, so §5.4's "never the old
   * questions" was enforced nowhere — measured at 2 already-seen questions in
   * a sampled 8-question check.
   *
   * rpc_revision_session_plan decides the contents instead: up to
   * REVISION_MISTAKE_MAX of the student's own misses, then REVISION_COUNT
   * questions they have never attempted. The ids travel in router state
   * because the plan is not persisted and a URL could only carry the chapter.
   *
   * The check still runs in the practice session runner — there is one
   * question-runner, and a second would drift from it.
   */
  async function startCheck(item: RevItem) {
    if (!ctx) return;
    setStartingId(item.id);
    try {
      const plan = await RecoveryEngineService.getRevisionSessionPlan(ctx, item.id);

      // `fresh`, NOT `total`. total counts the mistake half too, so a chapter
      // with five open mistakes and no unseen questions left produced
      // total = 5, sailed past this guard, and was refused by
      // rpc_submit_revision_session AFTER the student had answered all five.
      // The planner refuses this case itself now (20261034000000); this stays
      // as the belt-and-braces for a plan that somehow arrives empty-handed.
      if (plan.fresh === 0) {
        toast.message(
          `There is nothing new left in ${displayChapter(item.chapter) || item.chapter} to check you on yet — every question in it has already come up.`,
        );
        return;
      }

      // §4.2a's principle, applied to revision: short, and SAYS SO.
      if (plan.fresh_short > 0) {
        toast.message(
          `This check is ${plan.total} ${plan.total === 1 ? "question" : "questions"} — ${plan.fresh_short} fewer than usual, because that is all the new material this chapter has left.`,
        );
      }

      navigate("/student/practice", {
        state: {
          revision: {
            chapterId: item.id,
            questionIds: plan.question_ids,
            mistakes: plan.mistakes,
            fresh: plan.fresh,
            freshShort: plan.fresh_short,
          },
        },
      });
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not build the revision check"));
    } finally {
      setStartingId(null);
    }
  }

  function openPractice(item: RevItem) {
    const qs = new URLSearchParams();
    qs.set("chapter", item.chapter);
    if (item.subject) qs.set("subject", item.subject);
    navigate(`/student/practice?${qs.toString()}`);
  }

  // Was a bare spinning RotateCcw with no label — the third of the three
  // unlabelled-spinner screens the emptyStates guard could not see.
  //
  // No `action` while loading: the header's badge is a streak count.
  const header = (
    <PageHeader
      eyebrow="Learning"
      title="Revision"
      subtitle="Spaced-repetition review to move concepts into long-term memory."
    />
  );

  if (items.status === "loading") {
    return (
      <div className="space-y-6">
        {header}
        <PageSkeleton label="Loading revision" className="space-y-6">
          <SkeletonCard className="p-4 space-y-2">
            <Skeleton className="w-5 h-5 rounded" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </SkeletonCard>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 rounded-xl" />
            ))}
          </div>
          <SkeletonList rows={4} />
        </PageSkeleton>
      </div>
    );
  }

  if (!academicReady) {
    return <div className="space-y-6">{header}<NoStudentProfile /></div>;
  }

  if (items.status === "failed") {
    return (
      <div className="space-y-6">
        {header}
        <GlassCard className="p-8 text-center">
          <AlertCircle className="w-8 h-8 text-violet-400 mx-auto mb-2"/>
          <p className="text-sm text-muted-foreground">Could not load your revision schedule</p>
          {items.message && <p className="text-xs text-muted-foreground mt-1">{items.message}</p>}
          <button type="button" onClick={reload}
            className="mt-3 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-secondary transition-all">
            Try again
          </button>
        </GlassCard>
      </div>
    );
  }

  const subjects = ["all", ...Array.from(new Set(REVISION_ITEMS.map((r) => r.subject)))];
  const filtered = REVISION_ITEMS.filter(r => {
    const matchFilter =
      filter === "all" ? true :
      filter === "due" ? (r.dueIn === "Now" || r.dueIn === "Today") :
      filter === "upcoming" ? !(r.dueIn === "Now" || r.dueIn === "Today") :
      true;
    const matchSub = subjectTab === "all" || r.subject === subjectTab;
    return matchFilter && matchSub;
  });

  const due = REVISION_ITEMS.filter(r => r.dueIn === "Now" || r.dueIn === "Today");
  // Quick Revision starts a CHECK, so it counts and opens only due chapters
  // that can give one. It took the first due chapter whatever its bank held,
  // and a chapter with nothing unseen left answered the tap with a toast.
  const dueTakeable = due.filter(r => r.freshAvailable > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow="Learning"
        title="Revision"
        subtitle="Spaced-repetition review to move concepts into long-term memory."
        action={
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Flame className="w-3.5 h-3.5 text-amber-400"/>
            <span className="text-xs font-bold text-amber-400">{streak > 0 ? `${streak}-day streak` : "No streak yet"}</span>
          </div>
        }
      />

      {/* Quick actions — Flashcards and My Notes were "Coming soon"
          placeholders and came off, so this is a single tile now. */}
      <div className="grid gap-3">
        <button
          type="button"
          disabled={dueTakeable.length === 0}
          onClick={() => { void startCheck(dueTakeable[0]); }}
          className="p-4 rounded-2xl border border-violet-500/20 bg-violet-500/5 hover:bg-violet-500/10 transition-all text-left group disabled:opacity-50 disabled:pointer-events-none">
          <Zap className="w-5 h-5 text-violet-400 mb-2 group-hover:scale-110 transition-transform"/>
          <div className="text-sm font-bold text-foreground">Quick Revision</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {dueTakeable.length > 0
              ? `Starts the first of ${dueTakeable.length} due ${dueTakeable.length === 1 ? "check" : "checks"}`
              : due.length > 0
                ? "The chapters due have nothing new left to check you on"
                : "No items due"}
          </div>
        </button>
      </div>

      {/* Filter tabs */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {(["all","due","upcoming"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-all",
                filter === f ? "bg-violet-500/20 border border-violet-500/40 text-violet-500" : "bg-muted border border-border text-muted-foreground hover:bg-secondary")}>
              {f === "due" ? "Due Today" : f}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {subjects.map(s => (
            <button key={s} onClick={() => setSubjectTab(s)}
              className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold transition-all",
                subjectTab === s ? "bg-secondary border border-border text-foreground" : "bg-muted border border-border text-muted-foreground hover:bg-secondary")}>
              {s}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {filtered.length === 0 ? (
            <GlassCard className="p-8 text-center">
              <RotateCcw className="w-8 h-8 text-muted-foreground mx-auto mb-2"/>
              <p className="text-muted-foreground text-sm">No items match this filter</p>
            </GlassCard>
          ) : (
            filtered.map(item => (
              <RevItemCard key={item.id} item={item}
                busy={startingId === item.id}
                onRevise={() => openPractice(item)}
                onCheck={() => { void startCheck(item); }}/>
            ))
          )}
        </div>
      </div>

      {/* Revision streak */}
      <GlassCard className="p-5 border-amber-500/15">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
            <Flame className="w-6 h-6 text-amber-400"/>
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-foreground mb-0.5">
              {streak > 0 ? `${streak}-day learning streak` : "Start your revision streak"}
            </div>
            <div className="text-xs text-muted-foreground mb-2">
              {streak > 0
                ? "From your XP profile — keep practicing and revising to maintain it."
                : "Revise items from your queue to build a streak."}
            </div>
            <div className="text-xs text-muted-foreground">
              Current streak: <span className="text-amber-300 font-bold tabular-nums">{streak}</span> day{streak === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </GlassCard>

      {/* History — this said "not stored yet" long after
          rpc_submit_revision_session began writing a row for every check.
          It is stored, in revision_sessions, and a student who passed two of
          three and then failed has every reason to be able to see that. */}
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
          <History className="w-3.5 h-3.5"/>
          Revision History
        </div>
        {history.status === "loading" ? (
          <GlassCard className="p-6 text-center">
            <p role="status" className="text-xs text-muted-foreground">Loading…</p>
          </GlassCard>
        ) : history.status === "failed" ? (
          <GlassCard className="p-6 text-center">
            <p className="text-xs text-muted-foreground">
              Could not load revision history{history.message ? `: ${history.message}` : ""}.{" "}
              <button type="button" onClick={reloadHistory} className="font-semibold underline">Try again</button>
            </p>
          </GlassCard>
        ) : history.items.length === 0 ? (
          <GlassCard className="p-6 text-center">
            {/* §5.2: the clock starts on practice as well as on recovery. This
                said only "after you clear its recovery", which described one of
                the two ways in and not the one most students take. */}
            <p className="text-xs text-muted-foreground">
              No revision checks taken yet. A chapter's first check comes{" "}
              {REVISION_INTERVALS_DAYS[0]} days after you practise {REVISION_ENGAGEMENT_MIN} or more
              questions in it, or clear its recovery.
            </p>
          </GlassCard>
        ) : (
          <GlassCard className="p-3">
            <ul className="divide-y divide-border/60">
              {history.items.map((h) => (
                <li key={h.id} className="flex items-center gap-3 px-2 py-2.5">
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      h.passed ? "bg-emerald-400" : "bg-amber-400",
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-foreground truncate">
                      {h.chapter ?? "This chapter"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      check {h.stage} ·{" "}
                      {h.completed_at
                        ? new Date(h.completed_at).toLocaleDateString(undefined, {
                            day: "numeric", month: "short",
                          })
                        : "—"}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={cn(
                        "text-sm font-bold tabular-nums",
                        h.passed ? "text-emerald-400" : "text-amber-400",
                      )}
                    >
                      {h.correct}/{h.total}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {h.passed ? "passed" : "not passed"}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </GlassCard>
        )}
      </div>
    </div>
  );
}
