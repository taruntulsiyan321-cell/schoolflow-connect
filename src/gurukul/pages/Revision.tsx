import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAcademicContext } from "@/academic";
import { useRevisionItems, type RevItem } from "./useRevisionQueueV2";
import { useGurukulStudent } from "@/gurukul/StudentContext";
import { displayChapter, displayConcept } from "@/lib/academicDisplay";
import { GlassCard, NoStudentProfile, PageHeader, PageSkeleton, ProgressRing, Skeleton, SkeletonCard, SkeletonList, SubjectBadge, cn } from "@/gurukul/components/shared";
import {
  RotateCcw, CheckCircle2, AlertCircle, Flame, History, Bookmark,
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
  item, onRevise, onCheck,
}: {
  item: RevItem;
  onRevise: () => void;
  onCheck: () => void;
}) {
  const conceptLabel = displayConcept(item.concept);
  const chapterLabel = displayChapter(item.chapter);
  return (
    <GlassCard className="p-4 hover:border-border transition-all">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <DueTag dueIn={item.dueIn}/>
            <SubjectBadge subject={item.subject}/>
            {item.teacherAssigned && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">Teacher</span>
            )}
            {item.bookmarked && <Bookmark className="w-3.5 h-3.5 text-amber-400 fill-amber-400"/>}
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
          {/* The chapter line only when it says something the title does not.
              `concept` and `chapter` are frequently the same string for a
              revision item — "Areas Related to Circles" printed in bold and
              then again in grey directly beneath it — and when no chapter is
              recorded `displayChapter` returns "—", so the card rendered a
              lone dash as its subtitle. Neither is information. */}
          <div className="text-sm font-bold text-foreground">{conceptLabel}</div>
          {chapterLabel && chapterLabel !== "—" && chapterLabel !== conceptLabel && (
            <div className="text-[11px] text-muted-foreground mt-0.5">{chapterLabel}</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button onClick={onRevise}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-300 text-xs font-bold hover:bg-violet-500/30 transition-all">
          <Play className="w-3 h-3"/> Practice topic
        </button>
        <button onClick={onCheck}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/20 transition-all">
          <CheckCircle2 className="w-3 h-3"/> Take the check
        </button>
      </div>
    </GlassCard>
  );
}

export default function Revision() {
  const navigate = useNavigate();
  const student = useGurukulStudent();
  const { ctx, ready: academicReady } = useAcademicContext();
  const [filter, setFilter] = useState<"all"|"due"|"upcoming">("all");
  const [subjectTab, setSubjectTab] = useState("all");

  // useStudentAcademicSnapshot is gone from this screen. It was here only to
  // supply snapshot.revision_queue, and that queue is retired — every row in
  // it was due CURRENT_DATE because nothing applied the §5.3 intervals. The
  // engine hook below owns this screen's loading and error states now, so the
  // page no longer waits on a snapshot it reads nothing else from.
  const {
    items: REVISION_ITEMS,
    error,
    loading,
  } = useRevisionItems(ctx, academicReady);
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
   * The check runs in the practice session runner (there is only one
   * question-runner, and a second would drift from it). `revision` carries the
   * chapter UUID; the runner posts the score to rpc_submit_revision_session on
   * finish, and the server decides pass or fail and the next date.
   */
  function startCheck(item: RevItem) {
    const qs = new URLSearchParams();
    qs.set("chapter", item.chapter);
    if (item.subject) qs.set("subject", item.subject);
    qs.set("revision", item.id);
    navigate(`/student/practice?${qs.toString()}`);
  }

  function openPractice(item: RevItem) {
    const chapter = item.chapter !== "—" ? item.chapter : item.concept;
    const qs = new URLSearchParams();
    if (chapter && chapter !== "—") qs.set("chapter", chapter);
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

  if (loading) {
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

  if (error) {
    return (
      <GlassCard className="p-8 text-center">
        <AlertCircle className="w-8 h-8 text-violet-400 mx-auto mb-2"/>
        <p className="text-sm text-muted-foreground">Could not load revision queue</p>
        <p className="text-xs text-muted-foreground mt-1">{error}</p>
      </GlassCard>
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

  const dueNow = REVISION_ITEMS.filter(r => r.dueIn === "Now" || r.dueIn === "Today").length;

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
          disabled={dueNow === 0}
          onClick={() => {
          const due = REVISION_ITEMS.filter(r => r.dueIn === "Now" || r.dueIn === "Today")[0];
          if (due) startCheck(due);
          else toast.message("Nothing due — open any chapter below to practise it.");
        }}
          className="p-4 rounded-2xl border border-violet-500/20 bg-violet-500/5 hover:bg-violet-500/10 transition-all text-left group disabled:opacity-50 disabled:pointer-events-none">
          <Zap className="w-5 h-5 text-violet-400 mb-2 group-hover:scale-110 transition-transform"/>
          <div className="text-sm font-bold text-foreground">Quick Revision</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {dueNow > 0
              ? `Opens first of ${dueNow} due item${dueNow === 1 ? "" : "s"} in Practice`
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
                onRevise={() => openPractice(item)}
                onCheck={() => startCheck(item)}/>
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

      {/* History */}
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
          <History className="w-3.5 h-3.5"/>
          Revision History
        </div>
        <GlassCard className="p-6 text-center">
          <p className="text-xs text-muted-foreground">Revision history is not stored yet — completed items leave the queue above.</p>
        </GlassCard>
      </div>
    </div>
  );
}
