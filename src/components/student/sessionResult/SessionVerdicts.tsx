import { CheckCircle2, AlertCircle } from "lucide-react";
import { GlassCard } from "@/gurukul/components/shared";
import { cn } from "@/lib/utils";
import type { PracticeSessionResultState } from "@/lib/practiceSessionSnapshot";
import { recoveryVerdictLine } from "@/lib/recoveryVerdict";
import { RecoveryClearChapter } from "@/components/student/RecoveryClearChapter";
import { revisionCheckLabel, revisionSplitLine, revisionVerdictLine } from "@/lib/revisionVerdict";

type Props = {
  recovery: PracticeSessionResultState["recovery"] | null;
  revision: PracticeSessionResultState["revision"] | null;
};

/**
 * The engine's verdict on a recovery session or a revision check — quoted from
 * the session that just finished, never recomputed. A session is one or the
 * other, never both, so at most one card shows.
 */
export function SessionVerdicts({ recovery, revision }: Props) {
  return (
    <>
    {/* §4.2b — the recovery verdict, and it is deliberately TWO figures.
        "You can do the steps but the idea isn't solid yet" is actionable;
        a single blended 74% is not, and the spec calls that out by name.
        Rendered from the engine's own answer, never recomputed here. */}
    {recovery && (
      <GlassCard className="p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <div
            className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center",
              recovery.outcome === "ready" ? "bg-emerald-500/15" : "bg-amber-500/15",
            )}
          >
            {recovery.outcome === "ready"
              ? <CheckCircle2 className="w-4 h-4 text-success" />
              : <AlertCircle className="w-4 h-4 text-warning" />}
          </div>
          <div>
            <div className="text-sm font-bold text-foreground">
              {recovery.outcome === "ready" ? "Ready" : "Not solid yet"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {recoveryVerdictLine(recovery)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            {
              label: "Running the steps",
              sub: "the questions and their variants",
              rate: recovery.procedural_rate,
              passed: recovery.procedural_passed,
            },
            {
              label: "Understanding it",
              sub: "the idea reframed and applied",
              rate: recovery.conceptual_rate,
              passed: recovery.conceptual_passed,
            },
          ].map((r) => (
            <div
              key={r.label}
              className="p-3 rounded-xl border border-border/70 bg-surface/60"
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                {r.label}
              </div>
              <div
                className={cn(
                  "text-xl font-black tabular-nums",
                  r.passed ? "text-success" : "text-warning",
                )}
              >
                {/* A rate over zero questions is absent, not 0% — the tier
                    had nothing in it, which is a different statement. */}
                {r.rate == null ? "—" : `${Math.round(r.rate * 100)}%`}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{r.sub}</div>
            </div>
          ))}
        </div>

        {/* The round measures; the student clears (owner's ruling
            2026-09-28). The revision date is set when they do. */}
        <RecoveryClearChapter sessionId={recovery.session_id} ready={recovery.outcome === "ready"} />
      </GlassCard>
    )}

    {/* §5.3/§5.5 — the revision verdict. A session is a recovery session or
        a revision check, never both, so this and the card above cannot
        stack. Every figure here is the engine's: the threshold it passed,
        the rung it was for, the streak it is on, and the date it wrote. */}
    {revision && (
      <GlassCard className="p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <div
            className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center",
              revision.passed ? "bg-emerald-500/15" : "bg-amber-500/15",
            )}
          >
            {revision.passed
              ? <CheckCircle2 className="w-4 h-4 text-success" />
              : <AlertCircle className="w-4 h-4 text-warning" />}
          </div>
          <div>
            <div className="text-sm font-bold text-foreground">
              {revision.solid
                ? "Chapter solid"
                : revision.passed
                  ? "Revision check passed"
                  : "Revision check not passed"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {revisionVerdictLine(revision)}
            </div>
            {/* §5.4's two halves. The percentage above blends them; this
                line is the only place the student is told WHICH half went,
                and "you fixed the old ones, the new material faded" is a
                different instruction from "you still miss the same two". */}
            {revisionSplitLine(revision) && (
              <div className="text-[11px] text-muted-foreground mt-1">
                {revisionSplitLine(revision)}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl border border-border/70 bg-surface/60">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              This check
            </div>
            <div
              className={cn(
                "text-xl font-black tabular-nums",
                revision.passed ? "text-success" : "text-warning",
              )}
            >
              {Math.round(revision.rate * 100)}%
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {revisionCheckLabel(revision.stage, revision.stages_to_solid)}
            </div>
            {(revision.mistake_total > 0 || revision.fresh_total > 0) && (
              <div className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                {revision.mistake_correct}/{revision.mistake_total} old ·{" "}
                {revision.fresh_correct}/{revision.fresh_total} new
              </div>
            )}
          </div>
          <div className="p-3 rounded-xl border border-border/70 bg-surface/60">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              In a row
            </div>
            <div className="text-xl font-black tabular-nums text-foreground">
              {revision.consecutive_passes}
              {/* "/3" only on the way to solid: a solid chapter's run keeps
                  counting, and "5/3" read as more than the whole. */}
              {revision.consecutive_passes < revision.stages_to_solid && (
                <span className="text-sm text-muted-foreground">/{revision.stages_to_solid}</span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {revision.consecutive_passes < revision.stages_to_solid
                ? `${revision.stages_to_solid} in a row makes it solid`
                : "solid — it now comes back less often"}
            </div>
          </div>
        </div>

        {/* A solid chapter still has a date, at the long interval. Missing
            is now genuinely missing, and saying "off the list" for it would
            promise something the engine no longer does. */}
        <p className="text-[11px] text-muted-foreground mt-3">
          {revision.next_revision_at
            ? `Next check on ${new Date(revision.next_revision_at).toLocaleDateString(undefined, {
                day: "numeric", month: "short",
              })}.`
            : "No next check scheduled for this chapter."}
        </p>
      </GlassCard>
    )}

    </>
  );
}
